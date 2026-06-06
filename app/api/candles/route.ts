import { NextRequest, NextResponse } from "next/server";
import { enrichCandles, type Candle } from "@/lib/market";

export const dynamic = "force-dynamic";

type Provider = {
  name: string;
  baseUrl: string;
};

const PROVIDERS: Provider[] = [
  { name: "Binance Global", baseUrl: "https://api.binance.com" },
  { name: "Binance US", baseUrl: "https://api.binance.us" }
];

export async function GET(request: NextRequest) {
  const endTime = Number(request.nextUrl.searchParams.get("endTime"));
  const preferredSource = request.nextUrl.searchParams.get("source");
  const providers = orderedProviders(preferredSource);
  const errors: string[] = [];

  for (const provider of providers) {
    try {
      const candles = await fetchCandles(provider, Number.isFinite(endTime) ? endTime : undefined);
      return NextResponse.json({ source: provider.name, candles });
    } catch (error) {
      errors.push(`${provider.name}: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }

  return NextResponse.json(
    {
      error: "Unable to load BTC/USDT candle history.",
      details: errors
    },
    { status: 502 }
  );
}

function orderedProviders(source: string | null): Provider[] {
  const preferred = PROVIDERS.find((provider) => provider.name === source);
  if (!preferred) {
    return PROVIDERS;
  }
  return [preferred, ...PROVIDERS.filter((provider) => provider.name !== preferred.name)];
}

async function fetchCandles(provider: Provider, endTime?: number): Promise<Candle[]> {
  const params = new URLSearchParams({
    symbol: "BTCUSDT",
    interval: "15m",
    limit: "1000"
  });
  if (endTime) {
    params.set("endTime", String(endTime));
  }

  const response = await fetch(`${provider.baseUrl}/api/v3/klines?${params.toString()}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const now = Date.now();
  const rows = ((await response.json()) as unknown[][]).filter((row) => Number(row[6]) < now);
  const candles: Candle[] = rows.map((row) => ({
    timestamp: new Date(Number(row[0])).toISOString(),
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5])
  }));

  if (candles.length < 201) {
    throw new Error("Not enough candle history for EMA 200.");
  }

  return enrichCandles(candles).filter((candle) => candle.ema200 !== undefined).slice(-320);
}
