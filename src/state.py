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

    def save_positions(self, positions: dict[str, Position]) -> None:
        payload = {"positions": {symbol: asdict(pos) for symbol, pos in positions.items()}}
        tmp_path = self.path.with_suffix(".tmp")
        with tmp_path.open("w", encoding="utf-8") as file:
            json.dump(payload, file, indent=2)
        tmp_path.replace(self.path)
