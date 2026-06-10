"use client";

import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Bitcoin,
  BarChart3,
  CheckCircle2,
  CircleAlert,
  History,
  ListChecks,
  RefreshCw,
  ShieldCheck,
  Table2,
  Wallet,
  XCircle
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { formatNumber, formatUsd, type StrategySnapshot } from "@/lib/market";
import { StrategyChart } from "./strategy-chart";

type StreamStatus = "connecting" | "live" | "polling";
type DashboardTab = "chart" | "strategy" | "history" | "account";

const TABS: Array<{ id: DashboardTab; label: string; icon: ReactNode }> = [
  { id: "chart", label: "Chart", icon: <BarChart3 size={16} /> },
  { id: "strategy", label: "Strategy", icon: <ListChecks size={16} /> },
  { id: "history", label: "Trade History", icon: <History size={16} /> },
  { id: "account", label: "Account", icon: <Wallet size={16} /> }
];

export function DashboardClient({ initialMarket }: { initialMarket: StrategySnapshot }) {
  const [market, setMarket] = useState(initialMarket);
  const [chartCandles, setChartCandles] = useState(initialMarket.chartCandles);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [streamStatus, setStreamStatus] = useState<StreamStatus>("connecting");
  const [activeTab, setActiveTab] = useState<DashboardTab>("chart");

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
    const interval = window.setInterval(refreshMarket, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    let socket: WebSocket | undefined;
    let reconnectTimer: number | undefined;
    let closedByComponent = false;

    function connectTickerStream(streamIndex = 0) {
      setStreamStatus("connecting");
      const streamUrls = [
        "wss://stream.binance.com:9443/ws/btcusdt@trade",
        "wss://stream.binance.com:9443/ws/btcusdt@ticker",
        "wss://stream.binance.us:9443/ws/btcusdt@trade",
        "wss://stream.binance.us:9443/ws/btcusdt@ticker"
      ];
      const streamUrl = streamUrls[streamIndex] ?? streamUrls[0];
      socket = new WebSocket(streamUrl);

      socket.onopen = () => {
        setStreamStatus("live");
      };

      socket.onmessage = (event) => {
        const ticker = JSON.parse(event.data) as { c?: string; p?: string; P?: string; E?: number; T?: number };
        const price = Number(ticker.p ?? ticker.c);
        const changePct = Number(ticker.P);
        if (!Number.isFinite(price)) {
          return;
        }
        setMarket((current) => ({
          ...current,
          price,
          changePct: Number.isFinite(changePct) ? changePct : current.changePct,
          updatedAt: new Date(ticker.E ?? ticker.T ?? Date.now()).toISOString(),
          portfolio: markPortfolioToMarket(current, price)
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
        reconnectTimer = window.setTimeout(() => connectTickerStream((streamIndex + 1) % streamUrls.length), 2500);
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
  const pnlIsPositive = market.portfolio.profitLoss >= 0;

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
        <section className="terminal">
          <div className="ticker-strip">
            <div className="pair">
              <div className="coin">B</div>
              <div>
                <h2>{market.symbol}</h2>
                <p>{market.source} spot · 15m</p>
              </div>
            </div>
            <div className="ticker-price">
              <span>Last Price</span>
              <strong>{formatUsd(market.price)}</strong>
            </div>
            <Metric label="24h Change" value={`${market.changePct.toFixed(2)}%`} tone={changeIsPositive ? "positive" : "negative"} />
            <Metric label="Current Value" value={`${formatUsd(market.portfolio.currentValue)} USDT`} />
            <Metric
              label="Profit / Loss"
              value={`${formatSignedUsd(market.portfolio.profitLoss)} (${formatSignedPct(market.portfolio.profitLossPct)})`}
              tone={pnlIsPositive ? "positive" : "negative"}
            />
            <div className="ticker-status">
              <span className={`signal ${signalClass}`}>
                {market.signal === "BUY" && <ArrowUpRight size={18} />}
                {market.signal === "SELL" && <ArrowDownRight size={18} />}
                {market.signal === "HOLD" && <CircleAlert size={18} />}
                {market.signal}
              </span>
              <span className={`pill stream ${streamStatus}`}>
                <span />
                {streamStatus === "live" ? "Live" : streamStatus === "connecting" ? "Connecting" : "Polling"}
              </span>
            </div>
          </div>

          <div className="account-strip">
            <Metric label="USDT Balance" value={`${formatUsd(market.portfolio.cash)} USDT`} />
            <Metric label="BTC Position" value={`${formatNumber(market.portfolio.btcAmount, 8)} BTC`} />
            <Metric
              label="Open PnL"
              value={formatSignedUsd(market.portfolio.unrealizedProfitLoss)}
              tone={market.portfolio.unrealizedProfitLoss >= 0 ? "positive" : "negative"}
            />
            <Metric label="Realized PnL" value={formatSignedUsd(market.portfolio.realizedProfitLoss)} tone={market.portfolio.realizedProfitLoss >= 0 ? "positive" : "negative"} />
            <Metric label="Entry" value={market.portfolio.entryPrice ? formatUsd(market.portfolio.entryPrice) : "-"} />
            <span className={`position-badge ${market.portfolio.inPosition ? "active" : ""}`}>
              {market.portfolio.inPosition ? "In Position" : "No Position"}
            </span>
          </div>

          <nav className="tabs" aria-label="Dashboard sections">
            {TABS.map((tab) => (
              <button
                className={activeTab === tab.id ? "active" : ""}
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                type="button"
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </nav>

          <section className="tab-body">
            {activeTab === "chart" && (
              <StrategyChart candles={chartCandles} isLoadingOlder={isLoadingOlder} onLoadOlder={loadOlderCandles} />
            )}

            {activeTab === "strategy" && (
              <div className="panel-grid">
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
              </div>
            )}

            {activeTab === "history" && (
              <InfoCard title="Trade History" icon={<Table2 size={18} />}>
                <TradeHistory market={market} />
              </InfoCard>
            )}

            {activeTab === "account" && (
              <div className="panel-grid account-panel">
                <InfoCard title="Balances" icon={<Wallet size={18} />}>
                  <div className="metric-grid">
                    <Metric label="Initial Capital" value={`${formatUsd(market.portfolio.initialCapital)} USDT`} />
                    <Metric label="Current Value" value={`${formatUsd(market.portfolio.currentValue)} USDT`} />
                    <Metric label="Total Trades" value={String(market.portfolio.totalTrades)} />
                  </div>
                </InfoCard>

                <InfoCard title="Latest Trade" icon={<History size={18} />}>
                  <div className="status-list">
                    <div className="status-item">
                      <span>Last Trade</span>
                      <strong>
                        {market.portfolio.lastTrade
                          ? `${market.portfolio.lastTrade.side} @ ${formatUsd(market.portfolio.lastTrade.price)}`
                          : "-"}
                      </strong>
                    </div>
                    <div className="status-item">
                      <span>Updated</span>
                      <strong>{new Date(market.updatedAt).toLocaleTimeString()}</strong>
                    </div>
                    <div className="status-item">
                      <span>Allocation</span>
                      <strong>Full balance</strong>
                    </div>
                  </div>
                </InfoCard>
              </div>
            )}
          </section>
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

function Metric({ label, value, tone }: { label: string; value: string; tone?: "positive" | "negative" }) {
  return (
    <div className={`metric ${tone ?? ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function TradeHistory({ market }: { market: StrategySnapshot }) {
  if (market.portfolio.trades.length === 0) {
    return <p className="empty-state">No simulated trades yet.</p>;
  }

  return (
    <div className="table-wrap">
      <table className="trade-table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Side</th>
            <th>Price</th>
            <th>Amount</th>
            <th>Value</th>
            <th>PnL</th>
          </tr>
        </thead>
        <tbody>
          {[...market.portfolio.trades].reverse().map((trade) => (
            <tr key={`${trade.timestamp}-${trade.side}-${trade.price}`}>
              <td>{new Date(trade.timestamp).toLocaleString()}</td>
              <td>
                <span className={`side ${trade.side.toLowerCase()}`}>{trade.side}</span>
              </td>
              <td>{formatUsd(trade.price)}</td>
              <td>{formatNumber(trade.amount, 8)}</td>
              <td>{formatUsd(trade.value)}</td>
              <td className={trade.profitLoss === undefined ? "" : trade.profitLoss >= 0 ? "positive-text" : "negative-text"}>
                {trade.profitLoss === undefined ? "-" : `${formatSignedUsd(trade.profitLoss)} (${formatSignedPct(trade.profitLossPct ?? 0)})`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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

function markPortfolioToMarket(market: StrategySnapshot, price: number) {
  const currentValue = market.portfolio.cash + market.portfolio.btcAmount * price;
  const profitLoss = currentValue - market.portfolio.initialCapital;
  const unrealizedProfitLoss =
    market.portfolio.btcAmount > 0 ? market.portfolio.btcAmount * price - market.portfolio.positionCost : 0;

  return {
    ...market.portfolio,
    currentValue,
    profitLoss,
    profitLossPct: market.portfolio.initialCapital > 0 ? (profitLoss / market.portfolio.initialCapital) * 100 : 0,
    unrealizedProfitLoss
  };
}

function formatSignedUsd(value: number) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatUsd(value)}`;
}

function formatSignedPct(value: number) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}
