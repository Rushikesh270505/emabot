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

    logging.info("Starting bot for %s. dry_run=%s", ", ".join(config.symbols), config.dry_run)
    notifier.send(f"Bot started. dry_run={config.dry_run}")

    while True:
        for symbol in config.symbols:
            try:
                positions = _process_symbol(symbol, config, exchange, trade_logger, notifier, positions)
                state.save_positions(positions)
            except (ccxt.BaseError, ValueError, KeyError) as exc:
                logging.exception("Processing failed for %s: %s", symbol, exc)
                notifier.send(f"API/processing error for {symbol}: {exc}")
            except Exception as exc:
                logging.exception("Unexpected error for %s: %s", symbol, exc)
                notifier.send(f"Unexpected error for {symbol}: {exc}")
        time.sleep(int(raw["trading"].get("poll_seconds", 60)))


def _process_symbol(
    symbol: str,
    config,
    exchange: BinanceSpotExchange,
    trade_logger: TradeLogger,
    notifier: TelegramNotifier,
    positions: dict[str, Position],
) -> dict[str, Position]:
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
                return positions
            order = exchange.create_market_sell(symbol, amount, config.dry_run, close)
            balance = exchange.fetch_quote_balance(raw["trading"]["quote_currency"]) if not config.dry_run else ""
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
                    dry_run=config.dry_run,
                )
            )
            del positions[symbol]
        return positions

    if len(positions) >= int(raw["trading"].get("max_open_positions", len(config.symbols))):
        return positions

    signal = evaluate_entry(df)
    if signal.type != SignalType.BUY:
        return positions

    quote_currency = raw["trading"]["quote_currency"]
    balance = float(raw["backtest"]["starting_balance"]) if config.dry_run else exchange.fetch_quote_balance(quote_currency)
    stop_loss = recent_swing_low(
        df,
        lookback=int(raw["risk"]["swing_lookback"]),
        buffer_pct=float(raw["risk"].get("stop_buffer_pct", 0.0)),
    )
    amount = balance / close
    amount = exchange.amount_to_precision(symbol, amount)
    if amount <= 0:
        logging.info("Skipping %s because calculated amount is zero after precision rules", symbol)
        return positions

    stop_loss = exchange.price_to_precision(symbol, stop_loss)
    order = exchange.create_market_buy(symbol, amount, config.dry_run, close)

    positions[symbol] = Position(
        symbol=symbol,
        amount=order.amount,
        entry_price=order.price,
        stop_loss=stop_loss,
        opened_at=datetime.now(timezone.utc).isoformat(),
        take_profit=None,
        trailing_stop=None,
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
            dry_run=config.dry_run,
        )
    )
    return positions


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


if __name__ == "__main__":
    args = parse_args()
    run_bot(args.config)
