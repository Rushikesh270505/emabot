import csv
from pathlib import Path
from typing import Any


TRADE_LOG_FIELDS = [
    "timestamp",
    "symbol",
    "side",
    "amount",
    "price",
    "reason",
    "order_id",
    "status",
    "balance",
    "stop_loss",
    "take_profit",
]


class TradeLogger:
    """Append trade events to a CSV file."""

    def __init__(self, path: str):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if not self.path.exists():
            with self.path.open("w", newline="", encoding="utf-8") as file:
                writer = csv.DictWriter(file, fieldnames=TRADE_LOG_FIELDS)
                writer.writeheader()

    def log(self, event: dict[str, Any]) -> None:
        row = {field: event.get(field, "") for field in TRADE_LOG_FIELDS}
        with self.path.open("a", newline="", encoding="utf-8") as file:
            writer = csv.DictWriter(file, fieldnames=TRADE_LOG_FIELDS)
            writer.writerow(row)
