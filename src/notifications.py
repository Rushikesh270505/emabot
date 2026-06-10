from __future__ import annotations

import logging
import json
from typing import Any

import requests


class TelegramNotifier:
    """Small Telegram Bot API client for trading alerts."""

    def __init__(self, token: str | None, chat_id: str | None):
        self.token = token
        self.chat_id = chat_id or self._resolve_chat_id()
        self.enabled = bool(token and self.chat_id)

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

    def _resolve_chat_id(self) -> str | None:
        """Use the latest incoming bot update when TELEGRAM_CHAT_ID is not set."""
        if not self.token:
            return None
        url = f"https://api.telegram.org/bot{self.token}/getUpdates"
        try:
            response = requests.get(url, timeout=10)
            response.raise_for_status()
            payload = response.json()
        except (requests.RequestException, ValueError) as exc:
            logging.warning("Telegram chat id lookup failed: %s", exc)
            return None

        for update in reversed(payload.get("result", [])):
            message = update.get("message") or update.get("channel_post")
            chat = message.get("chat") if isinstance(message, dict) else None
            chat_id = chat.get("id") if isinstance(chat, dict) else None
            if chat_id is not None:
                return str(chat_id)
        logging.warning("Telegram chat id not found. Send /start to the bot, then restart EMABOT.")
        return None
