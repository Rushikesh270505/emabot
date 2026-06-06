from dataclasses import dataclass
from enum import Enum
from typing import Optional


class SignalType(str, Enum):
    BUY = "BUY"
    SELL = "SELL"
    HOLD = "HOLD"


@dataclass
class Signal:
    type: SignalType
    reason: str


@dataclass
class Position:
    symbol: str
    amount: float
    entry_price: float
    stop_loss: float
    opened_at: str
    take_profit: Optional[float] = None
    trailing_stop: Optional[float] = None


@dataclass
class OrderResult:
    symbol: str
    side: str
    amount: float
    price: float
    order_id: str
    status: str
    raw: dict
