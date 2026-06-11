import pandas as pd

from .indicators import has_crossed_above, has_crossed_below
from .models import Position, Signal, SignalType


def evaluate_entry(df: pd.DataFrame) -> Signal:
    """Evaluate entry rules based on EMA 9 and EMA 21 crossover with Option B timing."""
    if len(df) < 201 or df.iloc[-1].isna().any():
        return Signal(SignalType.HOLD, "Not enough indicator history")

    # Option B: Crossover happened on the candle before the latest closed candle (iloc[-2])
    # and the latest closed candle (iloc[-1]) confirms the trend is still active.
    crossover_confirmed = (
        has_crossed_above(df.iloc[:-1], "ema_9", "ema_21")
        and df.iloc[-1]["ema_9"] > df.iloc[-1]["ema_21"]
    )

    if crossover_confirmed:
        return Signal(SignalType.BUY, "EMA9 crossed above EMA21 (Option B confirmed)")
    return Signal(SignalType.HOLD, "Entry conditions not met")


def evaluate_exit(df: pd.DataFrame, position: Position) -> Signal:
    """Evaluate exit rules based on EMA 9 and EMA 21 crossover with Option B timing."""
    if len(df) < 201 or df.iloc[-1].isna().any():
        return Signal(SignalType.HOLD, "Not enough indicator history")

    # Option B: Crossover happened on the candle before the latest closed candle (iloc[-2])
    # and the latest closed candle (iloc[-1]) confirms the trend is still active.
    crossover_confirmed = (
        has_crossed_below(df.iloc[:-1], "ema_9", "ema_21")
        and df.iloc[-1]["ema_9"] < df.iloc[-1]["ema_21"]
    )

    if crossover_confirmed:
        return Signal(SignalType.SELL, "EMA9 crossed below EMA21 (Option B confirmed)")
    return Signal(SignalType.HOLD, "Exit conditions not met")

