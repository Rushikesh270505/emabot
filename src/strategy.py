import pandas as pd

from .indicators import has_crossed_above, has_crossed_below
from .models import Position, Signal, SignalType


def evaluate_entry(df: pd.DataFrame) -> Signal:
    """Evaluate the long-only spot entry rules on the latest closed candle."""
    if len(df) < 201 or df.iloc[-1].isna().any():
        return Signal(SignalType.HOLD, "Not enough indicator history")

    candle = df.iloc[-1]
    conditions = [
        candle["close"] > candle["ema_200"],
        has_crossed_above(df, "ema_9", "ema_21"),
        candle["rsi_14"] > 55,
        candle["close"] > candle["ema_9"] and candle["close"] > candle["ema_21"],
        candle["volume"] > candle["volume_sma_20"],
    ]

    if all(conditions):
        return Signal(SignalType.BUY, "EMA9 crossed above EMA21 with trend, RSI, close, and volume confirmation")
    return Signal(SignalType.HOLD, "Entry conditions not met")


def evaluate_exit(df: pd.DataFrame, position: Position) -> Signal:
    """Evaluate exit rules including stop loss, take profit, EMA exit, and RSI exit."""
    if len(df) < 2 or df.iloc[-1].isna().any():
        return Signal(SignalType.HOLD, "Not enough indicator history")

    candle = df.iloc[-1]
    close = float(candle["close"])
    low = float(candle["low"])

    if low <= position.stop_loss:
        return Signal(SignalType.SELL, "Stop loss hit")
    if close >= position.take_profit:
        return Signal(SignalType.SELL, "Take profit hit")
    if position.trailing_stop is not None and close <= position.trailing_stop:
        return Signal(SignalType.SELL, "EMA21 trailing stop hit")
    if has_crossed_below(df, "ema_9", "ema_21"):
        return Signal(SignalType.SELL, "EMA9 crossed below EMA21")
    if candle["rsi_14"] < 45:
        return Signal(SignalType.SELL, "RSI fell below 45")
    return Signal(SignalType.HOLD, "Exit conditions not met")
