from __future__ import annotations

import pandas as pd


def recent_swing_low(df: pd.DataFrame, lookback: int, buffer_pct: float) -> float:
    """Find a stop below the lowest low in the recent lookback window."""
    if len(df) < lookback:
        raise ValueError("Not enough candles to calculate swing low")
    swing_low = float(df["low"].tail(lookback).min())
    return swing_low * (1 - buffer_pct)


def update_ema_trailing_stop(current_stop: float | None, ema_21: float) -> float:
    """Move trailing stop upward only, using EMA21 as the trailing reference."""
    if current_stop is None:
        return float(ema_21)
    return max(float(current_stop), float(ema_21))
