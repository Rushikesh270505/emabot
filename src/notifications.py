import logging
import json
from typing import Any

import requests


class TelegramNotifier:
    """Small Telegram Bot API client for trading alerts."""

    def __init__(self, token: str | None, chat_id: str | None):
        self.token = token
        self.chat_id = chat_id
        self.enabled = bool(token and chat_id)

    def send(self, message: str) -> None:
        if not self.enabled:
            return
        url = f"https://api.telegram.org/bot{self.token}/sendMessage"
        try:
            response = requests.post(
                url,
                json={"chat_id": self.chat_id, "text": message},
                timeout=10,
            )
            response.raise_for_status()
        except requests.RequestException as exc:
            logging.warning("Telegram notification failed: %s", exc)

    def send_json(self, payload: dict[str, Any]) -> None:
        """Send a pretty JSON payload as a Telegram text message."""
        message = json.dumps(payload, indent=2, sort_keys=True, default=str)
        self.send(message)
