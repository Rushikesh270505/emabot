import { NextResponse } from "next/server";
import { buildSnapshot, type Candle } from "@/lib/market";

export const dynamic = "force-dynamic";

export async function GET() {
  const url = "https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=15m&limit=260";

  try {
    const response = await fetch(url, {
      next: { revalidate: 30 }
    });

    if (!response.ok) {
      return NextResponse.json({ error: "Binance market data request failed" }, { status: 502 });
    }

    const rows = (await response.json()) as unknown[][];
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

    return NextResponse.json(buildSnapshot(candles));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown market data error" },
      { status: 500 }
    );
  }
}
