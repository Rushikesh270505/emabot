"use client";

import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Bitcoin,
  CheckCircle2,
  CircleAlert,
  Clock3,
  RefreshCw,
  ShieldCheck,
  XCircle
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { formatNumber, formatUsd, type StrategySnapshot } from "@/lib/market";
import { StrategyChart } from "./strategy-chart";

type StreamStatus = "connecting" | "live" | "polling";

export function DashboardClient({ initialMarket }: { initialMarket: StrategySnapshot }) {
  const [market, setMarket] = useState(initialMarket);
  const [chartCandles, setChartCandles] = useState(initialMarket.chartCandles);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [streamStatus, setStreamStatus] = useState<StreamStatus>("connecting");

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
          setChartCandles((current) => mergeCandles(current, nextMarket.chartCandles));
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

  useEffect(() => {
    let socket: WebSocket | undefined;
    let reconnectTimer: number | undefined;
    let closedByComponent = false;

    function connectTickerStream() {
      setStreamStatus("connecting");
      const streamUrl = market.source === "Binance US"
        ? "wss://stream.binance.us:9443/ws/btcusdt@ticker"
        : "wss://stream.binance.com:9443/ws/btcusdt@ticker";
      socket = new WebSocket(streamUrl);

      socket.onopen = () => {
        setStreamStatus("live");
      };

      socket.onmessage = (event) => {
        const ticker = JSON.parse(event.data) as { c?: string; P?: string; E?: number };
        const price = Number(ticker.c);
        const changePct = Number(ticker.P);
        if (!Number.isFinite(price)) {
          return;
        }
        setMarket((current) => ({
          ...current,
          price,
          changePct: Number.isFinite(changePct) ? changePct : current.changePct,
          updatedAt: new Date(ticker.E ?? Date.now()).toISOString()
        }));
      };

      socket.onerror = () => {
        setStreamStatus("polling");
      };

      socket.onclose = () => {
        if (closedByComponent) {
          return;
        }
        setStreamStatus("polling");
        reconnectTimer = window.setTimeout(connectTickerStream, 5000);
      };
    }

    connectTickerStream();

    return () => {
      closedByComponent = true;
      if (reconnectTimer) {
        window.clearTimeout(reconnectTimer);
      }
      socket?.close();
    };
  }, [market.source]);

  const signalClass = market.signal.toLowerCase();
  const changeIsPositive = market.changePct >= 0;

  async function loadOlderCandles() {
    if (isLoadingOlder || chartCandles.length === 0) {
      return;
    }

    try {
      setIsLoadingOlder(true);
      const oldest = new Date(chartCandles[0].timestamp).getTime();
      const params = new URLSearchParams({
        endTime: String(oldest - 1),
        source: market.source
      });
      const response = await fetch(`/api/candles?${params.toString()}`, { cache: "no-store" });
      if (!response.ok) {
        return;
      }
      const payload = (await response.json()) as { candles: typeof chartCandles };
      setChartCandles((current) => mergeCandles(payload.candles, current));
    } finally {
      setIsLoadingOlder(false);
    }
  }

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
            <Activity size={17} />
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
                  <p>{market.source} spot · live ticker plus 15m closed candles</p>
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
              <div className="market-pills">
                <span className={`pill stream ${streamStatus}`}>
                  <span />
                  {streamStatus === "live" ? "WebSocket live" : streamStatus === "connecting" ? "Connecting" : "Polling fallback"}
                </span>
                <span className={`pill ${changeIsPositive ? "ok" : "no"}`}>
                  {changeIsPositive ? <ArrowUpRight size={15} /> : <ArrowDownRight size={15} />}
                  {market.changePct.toFixed(2)}% · 24h
                </span>
              </div>
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
                <span>Data Source</span>
                <strong>{market.source}</strong>
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

        <StrategyChart candles={chartCandles} isLoadingOlder={isLoadingOlder} onLoadOlder={loadOlderCandles} />

        <section className="grid compact-grid">
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
        </section>

        <section className="grid compact-grid">
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

function mergeCandles<T extends { timestamp: string }>(left: T[], right: T[]): T[] {
  const byTimestamp = new Map<string, T>();
  [...left, ...right].forEach((candle) => {
    byTimestamp.set(candle.timestamp, candle);
  });
  return Array.from(byTimestamp.values()).sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
}
