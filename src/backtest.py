import argparse
from dataclasses import dataclass
from pathlib import Path

import pandas as pd

from .config import load_config
from .indicators import add_indicators
from .logger import TradeLogger
from .models import Position, SignalType
from .risk import (
    calculate_position_size,
    calculate_take_profit,
    cap_position_by_cash,
    recent_swing_low,
    update_ema_trailing_stop,
)
from .strategy import evaluate_entry, evaluate_exit


@dataclass
class BacktestResult:
    symbol: str
    starting_balance: float
    ending_balance: float
    trades: int
    wins: int
    losses: int

    @property
    def pnl(self) -> float:
        return self.ending_balance - self.starting_balance

    @property
    def win_rate(self) -> float:
        if self.trades == 0:
            return 0.0
        return self.wins / self.trades


def run_backtest(config_path: str, symbol: str) -> BacktestResult:
    """Run a single-symbol historical CSV backtest."""
    config = load_config(config_path)
    raw = config.raw
    starting_balance = float(raw["backtest"]["starting_balance"])
    balance = starting_balance
    fee_rate = float(raw["backtest"].get("fee_rate", 0.001))
    data_path = _csv_path(raw["backtest"]["data_dir"], symbol, config.timeframe)

    df = pd.read_csv(data_path)
    df = add_indicators(df)
    trade_logger = TradeLogger(f"logs/backtest_{symbol.replace('/', '_')}.csv")

    position: Position | None = None
    wins = 0
    losses = 0
    exits = 0

    for index in range(201, len(df)):
        window = df.iloc[: index + 1].copy()
        candle = window.iloc[-1]
        close = float(candle["close"])
        timestamp = str(candle["timestamp"])

        if position:
            if bool(raw["risk"].get("use_trailing_stop", True)):
                new_stop = update_ema_trailing_stop(position.trailing_stop or position.stop_loss, float(candle["ema_21"]))
                position.trailing_stop = min(new_stop, close)
                position.stop_loss = max(position.stop_loss, position.trailing_stop)

            signal = evaluate_exit(window, position)
            if signal.type == SignalType.SELL:
                exit_price = _exit_price(candle, position, close, signal.reason)
                proceeds = position.amount * exit_price
                fee = proceeds * fee_rate
                balance += proceeds - fee
                pnl = (exit_price - position.entry_price) * position.amount - fee
                wins += int(pnl > 0)
                losses += int(pnl <= 0)
                exits += 1
                trade_logger.log(
                    {
                        "timestamp": timestamp,
                        "symbol": symbol,
                        "side": "SELL",
                        "amount": position.amount,
                        "price": exit_price,
                        "reason": signal.reason,
                        "order_id": "backtest",
                        "status": "filled",
                        "balance": balance,
                        "stop_loss": position.stop_loss,
                        "take_profit": position.take_profit,
                    }
                )
                position = None
            continue

        signal = evaluate_entry(window)
        if signal.type != SignalType.BUY:
            continue

        stop_loss = recent_swing_low(
            window,
            lookback=int(raw["risk"]["swing_lookback"]),
            buffer_pct=float(raw["risk"].get("stop_buffer_pct", 0.0)),
        )
        amount = calculate_position_size(
            balance=balance,
            risk_per_trade=float(raw["risk"]["risk_per_trade"]),
            entry_price=close,
            stop_loss=stop_loss,
        )
        amount = cap_position_by_cash(amount, balance, close)
        if amount <= 0:
            continue

        cost = amount * close
        fee = cost * fee_rate
        if cost + fee > balance:
            amount = balance / (close * (1 + fee_rate))
            cost = amount * close
            fee = cost * fee_rate

        balance -= cost + fee
        take_profit = calculate_take_profit(close, stop_loss, float(raw["risk"]["reward_to_risk"]))
        position = Position(
            symbol=symbol,
            amount=amount,
            entry_price=close,
            stop_loss=stop_loss,
            take_profit=take_profit,
            opened_at=timestamp,
            trailing_stop=None,
        )
        trade_logger.log(
            {
                "timestamp": timestamp,
                "symbol": symbol,
                "side": "BUY",
                "amount": amount,
                "price": close,
                "reason": signal.reason,
                "order_id": "backtest",
                "status": "filled",
                "balance": balance,
                "stop_loss": stop_loss,
                "take_profit": take_profit,
            }
        )

    if position:
        final_close = float(df.iloc[-1]["close"])
        balance += position.amount * final_close * (1 - fee_rate)

    return BacktestResult(
        symbol=symbol,
        starting_balance=starting_balance,
        ending_balance=balance,
        trades=exits,
        wins=wins,
        losses=losses,
    )


def _csv_path(data_dir: str, symbol: str, timeframe: str) -> Path:
    filename = f"{symbol.replace('/', '_')}_{timeframe}.csv"
    path = Path(data_dir) / filename
    if not path.exists():
        raise FileNotFoundError(f"Historical data not found: {path}")
    return path


def _exit_price(candle: pd.Series, position: Position, close: float, reason: str) -> float:
    if "Stop loss" in reason:
        return position.stop_loss
    if "Take profit" in reason:
        return position.take_profit
    if "trailing stop" in reason:
        return position.trailing_stop or close
    return close


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Backtest Binance spot EMA strategy.")
    parser.add_argument("--config", default="config.yaml", help="Path to config YAML file.")
    parser.add_argument("--symbol", required=True, help="Symbol, for example BTC/USDT.")
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    result = run_backtest(args.config, args.symbol)
    print(f"Symbol: {result.symbol}")
    print(f"Starting balance: {result.starting_balance:.2f}")
    print(f"Ending balance: {result.ending_balance:.2f}")
    print(f"PnL: {result.pnl:.2f}")
    print(f"Trades: {result.trades}")
    print(f"Wins: {result.wins}")
    print(f"Losses: {result.losses}")
    print(f"Win rate: {result.win_rate:.2%}")
