import { NextResponse } from "next/server";
import { buildSnapshot, type Candle } from "@/lib/market";

export const dynamic = "force-dynamic";

export async function GET() {
  const candlesUrl = "https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=15m&limit=260";
  const tickerUrl = "https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT";

  try {
    const [candlesResponse, tickerResponse] = await Promise.all([
      fetch(candlesUrl, { cache: "no-store" }),
      fetch(tickerUrl, { cache: "no-store" })
    ]);

    if (!candlesResponse.ok || !tickerResponse.ok) {
      return NextResponse.json({ error: "Binance market data request failed" }, { status: 502 });
    }

    const rows = (await candlesResponse.json()) as unknown[][];
    const ticker = (await tickerResponse.json()) as { lastPrice: string; priceChangePercent: string };
    const now = Date.now();
    const closedRows = rows.filter((row) => Number(row[6]) < now);
    const candles: Candle[] = closedRows.map((row) => ({
      timestamp: new Date(Number(row[0])).toISOString(),
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[5])
    }));

    const snapshot = buildSnapshot(candles);

    return NextResponse.json({
      ...snapshot,
      price: Number(ticker.lastPrice),
      changePct: Number(ticker.priceChangePercent),
      updatedAt: new Date().toISOString()
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown market data error" },
      { status: 500 }
    );
  }
}
