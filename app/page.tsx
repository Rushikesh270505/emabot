import { CircleAlert } from "lucide-react";
import { DashboardClient } from "./dashboard-client";
import type { StrategySnapshot } from "@/lib/market";

export const dynamic = "force-dynamic";

async function getMarket(): Promise<StrategySnapshot> {
  const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000";
  const response = await fetch(`${baseUrl}/api/market`, {
    cache: "no-store"
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Unable to load BTC/USDT market data");
  }

  return response.json();
}

export default async function Home() {
  try {
    const market = await getMarket();
    return <DashboardClient initialMarket={market} />;
  } catch (error) {
    return <MarketError message={error instanceof Error ? error.message : "Unable to load BTC/USDT market data"} />;
  }
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
