from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

import ccxt
import pandas as pd

from .models import OrderResult


class BinanceSpotExchange:
    """ccxt Binance spot wrapper with graceful error handling."""

    def __init__(self, api_key: str | None, api_secret: str | None, sandbox: bool, rate_limit: bool):
        config: dict[str, Any] = {
            "enableRateLimit": rate_limit,
            "options": {"defaultType": "spot"},
        }
        if api_key and api_secret:
            config.update({"apiKey": api_key, "secret": api_secret})

        self.exchange = ccxt.binance(config)
        if sandbox:
            self.exchange.set_sandbox_mode(True)
        self.exchange.load_markets()

    def fetch_ohlcv(self, symbol: str, timeframe: str, limit: int) -> pd.DataFrame:
        try:
            candles = self.exchange.fetch_ohlcv(symbol, timeframe=timeframe, limit=limit)
        except ccxt.BaseError as exc:
            logging.exception("Failed to fetch OHLCV for %s: %s", symbol, exc)
            raise

        df = pd.DataFrame(candles, columns=["timestamp", "open", "high", "low", "close", "volume"])
        df["timestamp"] = pd.to_datetime(df["timestamp"], unit="ms", utc=True)
        return df

    def fetch_free_balance(self, currency: str) -> float:
        try:
            balance = self.exchange.fetch_balance()
            return float(balance.get("free", {}).get(currency, 0.0))
        except ccxt.BaseError as exc:
            logging.exception("Failed to fetch balance: %s", exc)
            raise

    def fetch_quote_balance(self, quote_currency: str) -> float:
        return self.fetch_free_balance(quote_currency)

    def amount_to_precision(self, symbol: str, amount: float) -> float:
        return float(self.exchange.amount_to_precision(symbol, amount))

    def price_to_precision(self, symbol: str, price: float) -> float:
        return float(self.exchange.price_to_precision(symbol, price))

    def create_market_buy(self, symbol: str, amount: float, dry_run: bool, price: float) -> OrderResult:
        return self._create_market_order(symbol, "buy", amount, dry_run, price)

    def create_market_sell(self, symbol: str, amount: float, dry_run: bool, price: float) -> OrderResult:
        return self._create_market_order(symbol, "sell", amount, dry_run, price)

    def _create_market_order(
        self,
        symbol: str,
        side: str,
        amount: float,
        dry_run: bool,
        price: float,
    ) -> OrderResult:
        if dry_run:
            return OrderResult(
                symbol=symbol,
                side=side,
                amount=amount,
                price=price,
                order_id=f"dry-run-{datetime.now(timezone.utc).isoformat()}",
                status="dry_run",
                raw={},
            )

        try:
            order = self.exchange.create_order(symbol=symbol, type="market", side=side, amount=amount)
        except ccxt.BaseError as exc:
            logging.exception("Order failed for %s %s %s: %s", side, amount, symbol, exc)
            raise

        average = order.get("average") or order.get("price") or price
        return OrderResult(
            symbol=symbol,
            side=side,
            amount=float(order.get("amount") or amount),
            price=float(average),
            order_id=str(order.get("id", "")),
            status=str(order.get("status", "")),
            raw=order,
        )
