import pandas as pd

from .indicators import has_crossed_above, has_crossed_below
from .models import Position, Signal, SignalType


def evaluate_entry(df: pd.DataFrame) -> Signal:
    """Evaluate entry rules based on EMA 9 and EMA 21 crossover with Option B timing."""
    if len(df) < 201 or df.iloc[-1].isna().any():
        return Signal(SignalType.HOLD, "Not enough indicator history")

    # Crossover on the latest closed candle (iloc[-1])
    crossover_confirmed = has_crossed_above(df, "ema_9", "ema_21")

    if crossover_confirmed:
        return Signal(SignalType.BUY, "EMA9 crossed above EMA21")
    return Signal(SignalType.HOLD, "Entry conditions not met")


def evaluate_exit(df: pd.DataFrame, position: Position) -> Signal:
    """Evaluate exit rules based on EMA 9 and EMA 21 crossover with Option B timing."""
    if len(df) < 201 or df.iloc[-1].isna().any():
        return Signal(SignalType.HOLD, "Not enough indicator history")

    # Crossover on the latest closed candle (iloc[-1])
    crossover_confirmed = has_crossed_below(df, "ema_9", "ema_21")

    if crossover_confirmed:
        return Signal(SignalType.SELL, "EMA9 crossed below EMA21")
    return Signal(SignalType.HOLD, "Exit conditions not met")

