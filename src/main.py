from __future__ import annotations

import argparse
import logging
import time
from datetime import datetime, timezone
from typing import Any

import ccxt
import pandas as pd

from .config import load_config
from .exchange import BinanceSpotExchange
from .indicators import add_indicators
from .logger import TradeLogger
from .models import Position, SignalType
from .notifications import TelegramNotifier
from .risk import (
    recent_swing_low,
    update_ema_trailing_stop,
)
from .state import StateStore
from .strategy import evaluate_entry, evaluate_exit


def run_bot(config_path: str) -> None:
    """Run the live Binance spot trading loop."""
    config = load_config(config_path)
    raw = config.raw

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )

    if not config.dry_run and (not config.api_key or not config.api_secret):
        raise ValueError("BINANCE_API_KEY and BINANCE_API_SECRET are required when dry_run is false.")

    exchange = BinanceSpotExchange(
        api_key=config.api_key,
        api_secret=config.api_secret,
        sandbox=bool(raw["exchange"].get("sandbox", False)),
        rate_limit=bool(raw["exchange"].get("rate_limit", True)),
    )
    notifier = TelegramNotifier(config.telegram_token, config.telegram_chat_id)
    trade_logger = TradeLogger(raw["storage"]["trade_log_csv"])
    state = StateStore(raw["storage"]["state_file"])
    positions = state.load_positions()
    quote_balance = state.load_quote_balance(float(raw["backtest"]["starting_balance"]))

    logging.info("Starting bot for %s. dry_run=%s", ", ".join(config.symbols), config.dry_run)
    notifier.send("ema bot started")
    last_balance_notification = 0.0

    while True:
        for symbol in config.symbols:
            try:
                positions, quote_balance = _process_symbol(
                    symbol,
                    config,
                    exchange,
                    trade_logger,
                    notifier,
                    positions,
                    quote_balance,
                )
                state.save_state(positions, quote_balance if config.dry_run else None)
            except (ccxt.BaseError, ValueError, KeyError) as exc:
                logging.exception("Processing failed for %s: %s", symbol, exc)
                notifier.send(f"API/processing error for {symbol}: {exc}")
            except Exception as exc:
                logging.exception("Unexpected error for %s: %s", symbol, exc)
                notifier.send(f"Unexpected error for {symbol}: {exc}")
        if time.time() - last_balance_notification >= 600:
            _send_balance_update(config, exchange, notifier, positions, quote_balance)
            last_balance_notification = time.time()
        time.sleep(int(raw["trading"].get("poll_seconds", 60)))


def _process_symbol(
    symbol: str,
    config,
    exchange: BinanceSpotExchange,
    trade_logger: TradeLogger,
    notifier: TelegramNotifier,
    positions: dict[str, Position],
    quote_balance: float,
) -> tuple[dict[str, Position], float]:
    raw = config.raw
    df = exchange.fetch_ohlcv(
        symbol=symbol,
        timeframe=config.timeframe,
        limit=int(raw["trading"].get("min_candles", 260)),
    )
    df = _closed_candles_only(df, config.timeframe)
    df = add_indicators(df)
    latest = df.iloc[-1]
    close = float(latest["close"])
    timestamp = str(latest["timestamp"])

    if symbol in positions:
        position = positions[symbol]
        if bool(raw["risk"].get("use_trailing_stop", True)):
            new_stop = update_ema_trailing_stop(position.trailing_stop or position.stop_loss, float(latest["ema_21"]))
            position.trailing_stop = min(new_stop, close)
            position.stop_loss = max(position.stop_loss, position.trailing_stop)

        signal = evaluate_exit(df, position)
        if signal.type == SignalType.SELL:
            amount = position.amount if config.dry_run else exchange.fetch_free_balance(_base_currency(symbol))
            amount = exchange.amount_to_precision(symbol, amount)
            if amount <= 0:
                logging.info("Skipping %s sell because available base balance is zero", symbol)
                return positions, quote_balance
            order = exchange.create_market_sell(symbol, amount, config.dry_run, close)
            if config.dry_run:
                proceeds = order.amount * order.price
                quote_balance += proceeds
                balance: float | str = quote_balance
            else:
                balance = exchange.fetch_quote_balance(raw["trading"]["quote_currency"])
            profit = _profit_payload(position.entry_price, order.price, order.amount)
            del positions[symbol]
            account = _account_payload(
                float(raw["backtest"]["starting_balance"]),
                float(balance),
                {},
            )
            trade_logger.log(
                {
                    "timestamp": timestamp,
                    "symbol": symbol,
                    "side": "SELL",
                    "amount": order.amount,
                    "price": order.price,
                    "reason": signal.reason,
                    "order_id": order.order_id,
                    "status": order.status,
                    "balance": balance,
                    "stop_loss": position.stop_loss,
                    "take_profit": "",
                }
            )
            notifier.send_json(
                _trade_alert_payload(
                    event=_exit_event(signal.reason),
                    symbol=symbol,
                    side="SELL",
                    timestamp=timestamp,
                    amount=order.amount,
                    price=order.price,
                    reason=signal.reason,
                    order_id=order.order_id,
                    status=order.status,
                    balance=balance,
                    stop_loss=position.stop_loss,
                    take_profit=None,
                    profit=profit,
                    account=account,
                    dry_run=config.dry_run,
                )
            )
        return positions, quote_balance

    if len(positions) >= int(raw["trading"].get("max_open_positions", len(config.symbols))):
        return positions, quote_balance

    signal = evaluate_entry(df)
    if signal.type != SignalType.BUY:
        return positions, quote_balance

    quote_currency = raw["trading"]["quote_currency"]
    balance = quote_balance if config.dry_run else exchange.fetch_quote_balance(quote_currency)
    stop_loss = recent_swing_low(
        df,
        lookback=int(raw["risk"]["swing_lookback"]),
        buffer_pct=float(raw["risk"].get("stop_buffer_pct", 0.0)),
    )
    amount = balance / close
    amount = exchange.amount_to_precision(symbol, amount)
    if amount <= 0:
        logging.info("Skipping %s because calculated amount is zero after precision rules", symbol)
        return positions, quote_balance

    stop_loss = exchange.price_to_precision(symbol, stop_loss)
    order = exchange.create_market_buy(symbol, amount, config.dry_run, close)
    if config.dry_run:
        quote_balance = max(0.0, quote_balance - order.amount * order.price)
        balance = quote_balance

    positions[symbol] = Position(
        symbol=symbol,
        amount=order.amount,
        entry_price=order.price,
        stop_loss=stop_loss,
        opened_at=datetime.now(timezone.utc).isoformat(),
        take_profit=None,
        trailing_stop=None,
    )
    account = _account_payload(
        float(raw["backtest"]["starting_balance"]),
        float(balance),
        {
            symbol: {
                "amount": order.amount,
                "entry_price": order.price,
                "current_price": close,
            }
        },
    )
    trade_logger.log(
        {
            "timestamp": timestamp,
            "symbol": symbol,
            "side": "BUY",
            "amount": order.amount,
            "price": order.price,
            "reason": signal.reason,
            "order_id": order.order_id,
            "status": order.status,
            "balance": balance,
            "stop_loss": stop_loss,
            "take_profit": "",
        }
    )
    notifier.send_json(
        _trade_alert_payload(
            event="BUY",
            symbol=symbol,
            side="BUY",
            timestamp=timestamp,
            amount=order.amount,
            price=order.price,
            reason=signal.reason,
            order_id=order.order_id,
            status=order.status,
            balance=balance,
            stop_loss=stop_loss,
            take_profit=None,
            account=account,
            dry_run=config.dry_run,
        )
    )
    return positions, quote_balance


def _send_balance_update(
    config,
    exchange: BinanceSpotExchange,
    notifier: TelegramNotifier,
    positions: dict[str, Position],
    dry_run_quote_balance: float,
) -> None:
    """Send periodic account balance state to Telegram."""
    raw = config.raw
    quote_currency = raw["trading"]["quote_currency"]
    timestamp = datetime.now(timezone.utc).isoformat()

    if config.dry_run:
        quote_balance: float | str = dry_run_quote_balance
        base_balances = {
            position.symbol: {
                "amount": position.amount,
                "entry_price": position.entry_price,
                "current_price": _latest_close(exchange, position.symbol, config.timeframe),
            }
            for position in positions.values()
        }
    else:
        quote_balance = exchange.fetch_quote_balance(quote_currency)
        base_balances = {
            symbol: {
                "amount": exchange.fetch_free_balance(_base_currency(symbol)),
                "entry_price": position.entry_price,
                "current_price": _latest_close(exchange, symbol, config.timeframe),
            }
            for symbol, position in positions.items()
        }
    account = _account_payload(float(raw["backtest"]["starting_balance"]), float(quote_balance), base_balances)

    notifier.send_json(
        {
            "event": "BALANCE_UPDATE",
            "timestamp": timestamp,
            "quote_currency": quote_currency,
            "quote_balance": quote_balance,
            "positions": base_balances,
            "account": account,
            "dry_run": config.dry_run,
        }
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run Binance spot EMA trading bot.")
    parser.add_argument("--config", default="config.yaml", help="Path to config YAML file.")
    return parser.parse_args()


def _closed_candles_only(df: pd.DataFrame, timeframe: str) -> pd.DataFrame:
    """Drop the active candle if Binance returned one that has not closed yet."""
    if df.empty:
        return df
    timeframe_delta = _timeframe_to_timedelta(timeframe)
    latest_open = pd.to_datetime(df.iloc[-1]["timestamp"], utc=True)
    latest_close_time = latest_open + timeframe_delta
    now = pd.Timestamp.now(tz="UTC")
    if latest_close_time > now:
        return df.iloc[:-1].copy()
    return df


def _timeframe_to_timedelta(timeframe: str) -> pd.Timedelta:
    """Convert ccxt-style timeframe strings to pandas timedeltas."""
    unit = timeframe[-1]
    value = int(timeframe[:-1])
    if unit == "m":
        return pd.Timedelta(minutes=value)
    if unit == "h":
        return pd.Timedelta(hours=value)
    if unit == "d":
        return pd.Timedelta(days=value)
    raise ValueError(f"Unsupported timeframe: {timeframe}")


def _trade_alert_payload(
    event: str,
    symbol: str,
    side: str,
    timestamp: str,
    amount: float,
    price: float,
    reason: str,
    order_id: str,
    status: str,
    balance: float | str,
    stop_loss: float,
    take_profit: float | None,
    dry_run: bool,
    profit: dict[str, float] | None = None,
    account: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Create consistent JSON alert bodies for Telegram trade events."""
    return {
        "event": event,
        "symbol": symbol,
        "market": "spot",
        "timeframe": "15m",
        "side": side,
        "timestamp": timestamp,
        "amount": amount,
        "price": price,
        "reason": reason,
        "order_id": order_id,
        "status": status,
        "balance": balance,
        "risk": {
            "stop_loss": stop_loss,
            "take_profit": take_profit,
        },
        "profit": profit,
        "account": account,
        "allocation": "full_balance",
        "dry_run": dry_run,
    }


def _exit_event(reason: str) -> str:
    """Map exit reasons to compact Telegram event names."""
    normalized = reason.lower()
    if "stop loss" in normalized:
        return "STOP_LOSS"
    return "SELL"


def _base_currency(symbol: str) -> str:
    """Return the base asset from a ccxt symbol like BTC/USDT."""
    return symbol.split("/", maxsplit=1)[0]


def _latest_close(exchange: BinanceSpotExchange, symbol: str, timeframe: str) -> float:
    """Fetch the latest available close for wallet mark-to-market updates."""
    df = exchange.fetch_ohlcv(symbol=symbol, timeframe=timeframe, limit=2)
    return float(df.iloc[-1]["close"])


def _account_payload(
    initial_capital: float,
    quote_balance: float,
    positions: dict[str, dict[str, float]],
) -> dict[str, Any]:
    """Create a wallet-style mark-to-market account summary."""
    position_values: dict[str, dict[str, float]] = {}
    total_position_value = 0.0
    unrealized_profit_loss = 0.0

    for symbol, position in positions.items():
        amount = float(position["amount"])
        entry_price = float(position["entry_price"])
        current_price = float(position["current_price"])
        current_value = amount * current_price
        cost_basis = amount * entry_price
        position_profit_loss = current_value - cost_basis
        position_profit_loss_pct = (position_profit_loss / cost_basis) * 100 if cost_basis else 0.0
        total_position_value += current_value
        unrealized_profit_loss += position_profit_loss
        position_values[symbol] = {
            "amount": amount,
            "entry_price": entry_price,
            "current_price": current_price,
            "cost_basis": cost_basis,
            "current_value": current_value,
            "unrealized_profit_loss": position_profit_loss,
            "unrealized_profit_loss_pct": position_profit_loss_pct,
        }

    current_value = quote_balance + total_position_value
    profit_loss = current_value - initial_capital
    profit_loss_pct = (profit_loss / initial_capital) * 100 if initial_capital else 0.0
    realized_profit_loss = profit_loss - unrealized_profit_loss

    return {
        "initial_capital": initial_capital,
        "current_value": current_value,
        "quote_balance": quote_balance,
        "position_value": total_position_value,
        "profit_loss": profit_loss,
        "profit_loss_pct": profit_loss_pct,
        "realized_profit_loss": realized_profit_loss,
        "unrealized_profit_loss": unrealized_profit_loss,
        "positions": position_values,
    }


def _profit_payload(entry_price: float, exit_price: float, amount: float) -> dict[str, float]:
    """Calculate realized profit for a completed spot exit before exchange fees."""
    profit_usdt = (exit_price - entry_price) * amount
    profit_pct = ((exit_price - entry_price) / entry_price) * 100 if entry_price else 0.0
    return {
        "entry_price": entry_price,
        "exit_price": exit_price,
        "amount": amount,
        "profit_usdt_before_fees": profit_usdt,
        "profit_pct_before_fees": profit_pct,
    }


if __name__ == "__main__":
    args = parse_args()
    run_bot(args.config)
