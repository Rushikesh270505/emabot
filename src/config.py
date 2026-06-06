import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml
from dotenv import load_dotenv


@dataclass(frozen=True)
class AppConfig:
    raw: dict[str, Any]
    api_key: str | None
    api_secret: str | None
    telegram_token: str | None
    telegram_chat_id: str | None

    @property
    def symbols(self) -> list[str]:
        return list(self.raw["trading"]["symbols"])

    @property
    def timeframe(self) -> str:
        return str(self.raw["trading"]["timeframe"])

    @property
    def dry_run(self) -> bool:
        return bool(self.raw["trading"].get("dry_run", True))


def load_config(config_path: str) -> AppConfig:
    """Load YAML configuration and environment variables."""
    load_dotenv()
    path = Path(config_path)
    if not path.exists():
        raise FileNotFoundError(f"Config file not found: {config_path}")

    with path.open("r", encoding="utf-8") as file:
        raw = yaml.safe_load(file) or {}

    _validate_config(raw)
    return AppConfig(
        raw=raw,
        api_key=os.getenv("BINANCE_API_KEY"),
        api_secret=os.getenv("BINANCE_API_SECRET"),
        telegram_token=os.getenv("TELEGRAM_BOT_TOKEN"),
        telegram_chat_id=os.getenv("TELEGRAM_CHAT_ID"),
    )


def _validate_config(raw: dict[str, Any]) -> None:
    required_sections = ["exchange", "trading", "risk", "orders", "storage", "backtest"]
    for section in required_sections:
        if section not in raw:
            raise ValueError(f"Missing config section: {section}")
    if raw["trading"].get("timeframe") != "15m":
        raise ValueError("This strategy is configured for the 15m timeframe only.")
    if not raw["trading"].get("symbols"):
        raise ValueError("At least one symbol must be configured.")
