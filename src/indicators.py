import pandas as pd
from ta.momentum import RSIIndicator
from ta.trend import EMAIndicator


REQUIRED_COLUMNS = ["timestamp", "open", "high", "low", "close", "volume"]


def normalize_ohlcv(df: pd.DataFrame) -> pd.DataFrame:
    """Return OHLCV data sorted by time with numeric market columns."""
    missing = [col for col in REQUIRED_COLUMNS if col not in df.columns]
    if missing:
        raise ValueError(f"Missing OHLCV columns: {missing}")

    output = df.copy()
    output["timestamp"] = pd.to_datetime(output["timestamp"], utc=True)
    for col in ["open", "high", "low", "close", "volume"]:
        output[col] = pd.to_numeric(output[col], errors="coerce")
    output = output.dropna(subset=REQUIRED_COLUMNS)
    return output.sort_values("timestamp").reset_index(drop=True)


def add_indicators(df: pd.DataFrame) -> pd.DataFrame:
    """Calculate all indicators required by the strategy."""
    output = normalize_ohlcv(df)
    output["ema_9"] = EMAIndicator(close=output["close"], window=9).ema_indicator()
    output["ema_21"] = EMAIndicator(close=output["close"], window=21).ema_indicator()
    output["ema_200"] = EMAIndicator(close=output["close"], window=200).ema_indicator()
    output["rsi_14"] = RSIIndicator(close=output["close"], window=14).rsi()
    output["volume_sma_20"] = output["volume"].rolling(window=20).mean()
    return output


def has_crossed_above(df: pd.DataFrame, fast_col: str, slow_col: str) -> bool:
    """Detect a fresh bullish crossover on the latest closed candle."""
    if len(df) < 2:
        return False
    prev = df.iloc[-2]
    curr = df.iloc[-1]
    return prev[fast_col] <= prev[slow_col] and curr[fast_col] > curr[slow_col]


def has_crossed_below(df: pd.DataFrame, fast_col: str, slow_col: str) -> bool:
    """Detect a fresh bearish crossover on the latest closed candle."""
    if len(df) < 2:
        return False
    prev = df.iloc[-2]
    curr = df.iloc[-1]
    return prev[fast_col] >= prev[slow_col] and curr[fast_col] < curr[slow_col]
