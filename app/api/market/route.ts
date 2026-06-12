import { NextResponse } from "next/server";
import { buildSnapshot, withPortfolioPrice, type Candle, type StrategySnapshot } from "@/lib/market";

export const dynamic = "force-dynamic";

type Provider = {
  name: string;
  baseUrl: string;
};

const PROVIDERS: Provider[] = [
  { name: "Binance Global", baseUrl: "https://api.binance.com" },
  { name: "Binance US", baseUrl: "https://api.binance.us" }
];

export async function GET() {
  const errors: string[] = [];

  for (const provider of PROVIDERS) {
    try {
      const market = await fetchProviderMarket(provider);
      return NextResponse.json(market);
    } catch (error) {
      errors.push(`${provider.name}: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }

  return NextResponse.json(
    {
      error: "Unable to load real BTC/USDT market data from Binance providers.",
      details: errors
    },
    { status: 502 }
  );
}

async function fetchProviderMarket(provider: Provider): Promise<StrategySnapshot> {
  const candlesUrl = `${provider.baseUrl}/api/v3/klines?symbol=BTCUSDT&interval=15m&limit=260`;
  const tickerUrl = `${provider.baseUrl}/api/v3/ticker/24hr?symbol=BTCUSDT`;

  const [candlesResponse, tickerResponse] = await Promise.all([
    fetch(candlesUrl, { cache: "no-store" }),
    fetch(tickerUrl, { cache: "no-store" })
  ]);

  if (!candlesResponse.ok || !tickerResponse.ok) {
    throw new Error(`HTTP ${candlesResponse.status}/${tickerResponse.status}`);
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

  let initialCapital = 100000;
  try {
    const fs = require("fs");
    const path = require("path");
    const configPath = path.join(process.cwd(), "config.yaml");
    if (fs.existsSync(configPath)) {
      const configText = fs.readFileSync(configPath, "utf-8");
      const balMatch = configText.match(/starting_balance:\s*(\S+)/);
      if (balMatch) initialCapital = Number(balMatch[1]) || 100000;
    }
  } catch (e) {}

  const snapshot = buildSnapshot(candles, initialCapital);

  return withPortfolioPrice({
    ...snapshot,
    source: provider.name,
    price: Number(ticker.lastPrice),
    changePct: Number(ticker.priceChangePercent),
    updatedAt: new Date().toISOString()
  }, Number(ticker.lastPrice));
}
