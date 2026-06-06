import pandas as pd


def recent_swing_low(df: pd.DataFrame, lookback: int, buffer_pct: float) -> float:
    """Find a stop below the lowest low in the recent lookback window."""
    if len(df) < lookback:
        raise ValueError("Not enough candles to calculate swing low")
    swing_low = float(df["low"].tail(lookback).min())
    return swing_low * (1 - buffer_pct)


def calculate_position_size(
    balance: float,
    risk_per_trade: float,
    entry_price: float,
    stop_loss: float,
) -> float:
    """Size position so max loss equals configured account risk."""
    if balance <= 0:
        raise ValueError("Balance must be greater than zero")
    if not 0 < risk_per_trade < 1:
        raise ValueError("risk_per_trade must be between 0 and 1")
    risk_per_unit = entry_price - stop_loss
    if risk_per_unit <= 0:
        raise ValueError("Stop loss must be below entry price")
    risk_amount = balance * risk_per_trade
    return risk_amount / risk_per_unit


def cap_position_by_cash(position_amount: float, balance: float, entry_price: float) -> float:
    """Prevent position size from exceeding available quote balance."""
    max_affordable = balance / entry_price
    return max(0.0, min(position_amount, max_affordable))


def update_ema_trailing_stop(current_stop: float | None, ema_21: float) -> float:
    """Move trailing stop upward only, using EMA21 as the trailing reference."""
    if current_stop is None:
        return float(ema_21)
    return max(float(current_stop), float(ema_21))
