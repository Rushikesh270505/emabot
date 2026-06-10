from __future__ import annotations

import json
from dataclasses import asdict
from pathlib import Path

from .models import Position


class StateStore:
    """Persist open positions so restarts do not duplicate entries."""

    def __init__(self, path: str):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def load_positions(self) -> dict[str, Position]:
        if not self.path.exists():
            return {}
        with self.path.open("r", encoding="utf-8") as file:
            payload = json.load(file)
        return {symbol: Position(**data) for symbol, data in payload.get("positions", {}).items()}

    def load_quote_balance(self, default: float) -> float:
        if not self.path.exists():
            return default
        with self.path.open("r", encoding="utf-8") as file:
            payload = json.load(file)
        if "quote_balance" not in payload and payload.get("positions"):
            return 0.0
        return float(payload.get("quote_balance", default))

    def save_positions(self, positions: dict[str, Position]) -> None:
        self.save_state(positions)

    def save_state(self, positions: dict[str, Position], quote_balance: float | None = None) -> None:
        payload = {"positions": {symbol: asdict(pos) for symbol, pos in positions.items()}}
        if quote_balance is not None:
            payload["quote_balance"] = quote_balance
        tmp_path = self.path.with_suffix(".tmp")
        with tmp_path.open("w", encoding="utf-8") as file:
            json.dump(payload, file, indent=2)
        tmp_path.replace(self.path)
