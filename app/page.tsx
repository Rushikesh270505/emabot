import { CircleAlert } from "lucide-react";
import { DashboardClient } from "./dashboard-client";
import { buildSnapshot, type Candle, type StrategySnapshot } from "@/lib/market";

export const dynamic = "force-dynamic";

async function getMarket(): Promise<StrategySnapshot> {
  const errors: string[] = [];

  for (const provider of PROVIDERS) {
    try {
      return await fetchProviderMarket(provider);
    } catch (error) {
      errors.push(`${provider.name}: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }

  throw new Error(errors.join(" | "));
}

export default async function Home() {
  try {
    const market = await getMarket();
    return <DashboardClient initialMarket={market} />;
  } catch (error) {
    return <MarketError message={error instanceof Error ? error.message : "Unable to load BTC/USDT market data"} />;
  }
}

type Provider = {
  name: string;
  baseUrl: string;
};

const PROVIDERS: Provider[] = [
  { name: "Binance Global", baseUrl: "https://api.binance.com" },
  { name: "Binance US", baseUrl: "https://api.binance.us" }
];

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

  const snapshot = buildSnapshot(candles);

  return {
    ...snapshot,
    source: provider.name,
    price: Number(ticker.lastPrice),
    changePct: Number(ticker.priceChangePercent),
    updatedAt: new Date().toISOString()
  };
}

function MarketError({ message }: { message: string }) {
  return (
    <main className="shell error-shell">
      <section className="error-panel">
        <CircleAlert size={34} />
        <h1>Live BTC/USDT Data Unavailable</h1>
        <p>{message}</p>
        <a className="button" href="/api/market">
          Check market API
        </a>
      </section>
    </main>
  );
}
