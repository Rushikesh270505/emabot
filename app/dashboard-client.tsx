"use client";

import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Bitcoin,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Radio,
  RefreshCw,
  Server,
  ShieldCheck,
  XCircle
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { formatNumber, formatUsd, type StrategySnapshot } from "@/lib/market";

export function DashboardClient({ initialMarket }: { initialMarket: StrategySnapshot }) {
  const [market, setMarket] = useState(initialMarket);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function refreshMarket() {
      try {
        setIsRefreshing(true);
        const response = await fetch("/api/market", { cache: "no-store" });
        if (!response.ok) {
          return;
        }
        const nextMarket = (await response.json()) as StrategySnapshot;
        if (!cancelled) {
          setMarket(nextMarket);
        }
      } finally {
        if (!cancelled) {
          setIsRefreshing(false);
        }
      }
    }

    refreshMarket();
    const interval = window.setInterval(refreshMarket, 10000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  const signalClass = market.signal.toLowerCase();
  const changeIsPositive = market.changePct >= 0;

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <div className="mark" aria-hidden="true">
            <Bitcoin size={22} />
          </div>
          <div>
            <h1>EMABOT BTC</h1>
            <p>BTC/USDT spot strategy · 15m</p>
          </div>
        </div>
        <div className="actions">
          <a className="button" href="/api/market" title="Open raw market snapshot">
            <Radio size={17} />
            Live data
          </a>
          <button className="icon-button" title="Refresh" aria-label="Refresh" onClick={() => window.location.reload()}>
            <RefreshCw size={18} className={isRefreshing ? "spin" : ""} />
          </button>
        </div>
      </header>

      <section className="dashboard">
        <div className="hero">
          <section className="market-panel">
            <div className="pair-row">
              <div className="pair">
                <div className="coin">B</div>
                <div>
                  <h2>{market.symbol}</h2>
                  <p>Binance spot · live ticker plus 15m closed candles</p>
                </div>
              </div>
              <span className="pill">
                <Clock3 size={15} />
                {new Date(market.updatedAt).toLocaleTimeString()}
              </span>
            </div>

            <p className="price">{formatUsd(market.price)}</p>

            <div className="signal-row">
              <div>
                <span className={`signal ${signalClass}`}>
                  {market.signal === "BUY" && <ArrowUpRight size={18} />}
                  {market.signal === "SELL" && <ArrowDownRight size={18} />}
                  {market.signal === "HOLD" && <CircleAlert size={18} />}
                  {market.signal}
                </span>
                <p className="signal-copy">{market.reason}</p>
              </div>
              <span className={`pill ${changeIsPositive ? "ok" : "no"}`}>
                {changeIsPositive ? <ArrowUpRight size={15} /> : <ArrowDownRight size={15} />}
                {market.changePct.toFixed(2)}% · 24h
              </span>
            </div>
          </section>

          <aside className="status">
            <div>
              <h3>Bot Scope</h3>
              <p>One pair, one timeframe, spot only.</p>
            </div>
            <div className="status-list">
              <div className="status-item">
                <span>Symbol</span>
                <strong>BTC/USDT</strong>
              </div>
              <div className="status-item">
                <span>Timeframe</span>
                <strong>15m</strong>
              </div>
              <div className="status-item">
                <span>Capital</span>
                <strong>100,000 USDT</strong>
              </div>
              <div className="status-item">
                <span>Risk</span>
                <strong>1% / trade</strong>
              </div>
            </div>
          </aside>
        </div>

        <section className="grid">
          <InfoCard title="Trend Filters" icon={<Activity size={18} />}>
            <div className="metric-grid">
              <Metric label="EMA 9" value={formatUsdValue(market.latest.ema9)} />
              <Metric label="EMA 21" value={formatUsdValue(market.latest.ema21)} />
              <Metric label="EMA 200" value={formatUsdValue(market.latest.ema200)} />
            </div>
          </InfoCard>

          <InfoCard title="Momentum" icon={<ShieldCheck size={18} />}>
            <div className="metric-grid">
              <Metric label="RSI 14" value={formatNumber(market.latest.rsi14, 1)} />
              <Metric label="Volume" value={formatNumber(market.latest.volume, 2)} />
              <Metric label="Vol SMA 20" value={formatNumber(market.latest.volumeSma20, 2)} />
            </div>
          </InfoCard>

          <InfoCard title="Execution Model" icon={<Server size={18} />}>
            <div className="checklist">
              <div className="check">
                <CheckCircle2 className="ok" size={18} />
                <span>Spot market orders via Python worker</span>
              </div>
              <div className="check">
                <CheckCircle2 className="ok" size={18} />
                <span>Swing-low stop, no fixed reward target</span>
              </div>
              <div className="check">
                <CheckCircle2 className="ok" size={18} />
                <span>JSON Telegram alerts on entries and exits</span>
              </div>
            </div>
          </InfoCard>
        </section>

        <section className="grid">
          <InfoCard title="Entry Checklist" icon={<CheckCircle2 size={18} />}>
            <div className="checklist">
              {market.conditions.map((condition) => (
                <div className="check" key={condition.label}>
                  {condition.passed ? <CheckCircle2 className="ok" size={18} /> : <XCircle className="no" size={18} />}
                  <span>{condition.label}</span>
                </div>
              ))}
            </div>
          </InfoCard>

          <InfoCard title="Exit Rules" icon={<ArrowDownRight size={18} />}>
            <div className="checklist">
              <div className="check">
                <CircleAlert className="muted" size={18} />
                <span>EMA 9 crosses below EMA 21</span>
              </div>
              <div className="check">
                <CircleAlert className="muted" size={18} />
                <span>RSI 14 falls below 45</span>
              </div>
              <div className="check">
                <CircleAlert className="muted" size={18} />
                <span>Stop loss or EMA 21 trailing stop</span>
              </div>
            </div>
          </InfoCard>

          <InfoCard title="Deployment" icon={<Radio size={18} />}>
            <div className="checklist">
              <div className="check">
                <CheckCircle2 className="ok" size={18} />
                <span>Vercel hosts this live dashboard</span>
              </div>
              <div className="check">
                <CircleAlert className="muted" size={18} />
                <span>Run Python worker on VPS or laptop</span>
              </div>
              <div className="check">
                <CircleAlert className="muted" size={18} />
                <span>Keep Binance withdrawals disabled</span>
              </div>
            </div>
          </InfoCard>
        </section>

        <section className="table-wrap">
          <div className="table-head">
            <div>
              <h3>Recent Closed Candles</h3>
              <p className="table-note">BTC/USDT · 15 minute OHLCV</p>
            </div>
            <span className="pill">Last {market.candles.length}</span>
          </div>
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Close</th>
                <th>EMA 9</th>
                <th>EMA 21</th>
                <th>RSI</th>
                <th>Volume</th>
              </tr>
            </thead>
            <tbody>
              {market.candles.map((candle) => (
                <tr key={candle.timestamp}>
                  <td>{new Date(candle.timestamp).toLocaleString()}</td>
                  <td>{formatUsd(candle.close)}</td>
                  <td>{formatUsdValue(candle.ema9)}</td>
                  <td>{formatUsdValue(candle.ema21)}</td>
                  <td>{formatNumber(candle.rsi14, 1)}</td>
                  <td>{formatNumber(candle.volume, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </section>
    </main>
  );
}

function InfoCard({
  title,
  icon,
  children
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="card">
      <div className="card-head">
        <h3>{title}</h3>
        <span className="pill">{icon}</span>
      </div>
      {children}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatUsdValue(value: number | undefined) {
  return value === undefined || Number.isNaN(value) ? "-" : formatUsd(value);
}
