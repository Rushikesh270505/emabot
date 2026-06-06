import { DashboardClient } from "./dashboard-client";
import { buildSnapshot, type Candle, type StrategySnapshot } from "@/lib/market";

export const dynamic = "force-dynamic";

async function getMarket(): Promise<StrategySnapshot> {
  const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000";
  const response = await fetch(`${baseUrl}/api/market`, {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error("Unable to load BTC/USDT market data");
  }

  return response.json();
}

export default async function Home() {
  let market: StrategySnapshot;

  try {
    market = await getMarket();
  } catch {
    market = fallbackSnapshot();
  }

  return <DashboardClient initialMarket={market} />;
}

function fallbackSnapshot(): StrategySnapshot {
  const now = Date.now();
  const candles: Candle[] = Array.from({ length: 260 }, (_, index) => {
    const close = 100000 + Math.sin(index / 8) * 1200 + index * 9;
    return {
      timestamp: new Date(now - (260 - index) * 15 * 60 * 1000).toISOString(),
      open: close - 120,
      high: close + 260,
      low: close - 300,
      close,
      volume: 20 + Math.cos(index / 7) * 4
    };
  });

  return buildSnapshot(candles);
}
