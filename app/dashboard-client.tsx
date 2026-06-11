"use client";

import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Bitcoin,
  BarChart3,
  CheckCircle2,
  History,
  ListChecks,
  RefreshCw,
  CircleAlert,
  ShieldCheck,
  Table2,
  XCircle,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { formatNumber, formatUsd, type StrategySnapshot, markPortfolioToMarket } from "@/lib/market";
import { StrategyChart } from "./strategy-chart";
import { Sidebar } from "./components/Sidebar";
import Speedometer from "./components/Speedometer";
import { sendTelegramMessage } from "./lib/telegram";

type StreamStatus = "connecting" | "live" | "polling";
type DashboardTab = "chart" | "strategy" | "history";

const TABS: Array<{ id: DashboardTab; label: string; icon: ReactNode }> = [
  { id: "chart", label: "Chart Info", icon: <BarChart3 size={16} /> },
  { id: "strategy", label: "EMA Filters", icon: <ListChecks size={16} /> },
  { id: "history", label: "Trade History", icon: <History size={16} /> }
];

export function DashboardClient({ initialMarket }: { initialMarket: StrategySnapshot }) {
  const [market, setMarket] = useState(initialMarket);
  const [chartCandles, setChartCandles] = useState(initialMarket.chartCandles);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [streamStatus, setStreamStatus] = useState<StreamStatus>("connecting");
  const [activeTab, setActiveTab] = useState<DashboardTab>("chart");
  const [hash, setHash] = useState("");

  const [waitingForCrossover, setWaitingForCrossover] = useState(false);
  const [waitingForSellCrossover, setWaitingForSellCrossover] = useState(false);



  useEffect(() => {
    const syncHash = () => {
      const hash = window.location.hash.replace('#', '');
      setHash(hash);
      if (["chart", "strategy", "history"].includes(hash)) {
        setActiveTab(hash as DashboardTab);
      }
    };
    syncHash();
    window.addEventListener('hashchange', syncHash);
    return () => window.removeEventListener('hashchange', syncHash);
  }, []);


  // API Config States
  const [apiConfig, setApiConfig] = useState({
    symbol: "BTC/USDT",
    timeframe: "15m",
    allottedBalance: 100000,
    hasApiKey: false,
    hasApiSecret: false
  });
  const [formKey, setFormKey] = useState("");
  const [formSecret, setFormSecret] = useState("");
  const [formSymbol, setFormSymbol] = useState("BTC/USDT");
  const [formTimeframe, setFormTimeframe] = useState("15m");
  const [formBalance, setFormBalance] = useState("100000");
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [configSuccess, setConfigSuccess] = useState<string | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);

  // Fetch current config on mount
  useEffect(() => {
    async function fetchConfig() {
      try {
        const res = await fetch("/api/config");
        if (res.ok) {
          const data = await res.json();
          setApiConfig(data);
          setFormSymbol(data.symbol);
          setFormTimeframe(data.timeframe);
          setFormBalance(String(data.allottedBalance));
        }
      } catch (err) {
        console.error("Failed to fetch config:", err);
      }
    }
    fetchConfig();
  }, []);

  // Sync market data via REST polling
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
          setChartCandles((current) => mergeCandles(current, nextMarket.chartCandles));
          setMarket((current) => {
            const isManual = (current?.portfolio as any)?.isManual;
            if (isManual) {
              return {
                ...nextMarket,
                portfolio: markPortfolioToMarket(current.portfolio, nextMarket.price)
              };
            }
            return nextMarket;
          });
        }
      } finally {
        if (!cancelled) {
          setIsRefreshing(false);
        }
      }
    }

    refreshMarket();
    const interval = window.setInterval(refreshMarket, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  // Reset manual mode after next BUY crossover following a manual sell
  useEffect(() => {
    if (waitingForCrossover && market.signal === "BUY") {
      setMarket((prev) => ({
        ...prev,
        portfolio: { ...prev.portfolio, isManual: false }
      }));
      setWaitingForCrossover(false);
    }
  }, [market.signal, waitingForCrossover]);



  // Reset manual mode after next SELL crossover following a manual buy
  useEffect(() => {
    if (waitingForSellCrossover && market.signal === "SELL") {
      setMarket((current) => {
        if (!current.portfolio.inPosition || current.portfolio.btcAmount <= 0) return current;
        const price = current.price;
        const cashValue = current.portfolio.btcAmount * price;
        const profitLoss = cashValue - current.portfolio.positionCost;
        const profitLossPct = current.portfolio.positionCost > 0 ? (profitLoss / current.portfolio.positionCost) * 100 : 0;
        const newTrade = {
          timestamp: new Date().toISOString(),
          side: "SELL" as const,
          price,
          amount: current.portfolio.btcAmount,
          value: cashValue,
          profitLoss,
          profitLossPct
        };
        const updatedPortfolio = {
          ...current.portfolio,
          isManual: true,
          cash: cashValue,
          btcAmount: 0,
          entryPrice: null,
          positionCost: 0,
          inPosition: false,
          realizedProfitLoss: current.portfolio.realizedProfitLoss + profitLoss,
          lastTrade: newTrade,
          totalTrades: current.portfolio.totalTrades + 1,
          trades: [...current.portfolio.trades, newTrade]
        };
        return { ...current, portfolio: markPortfolioToMarket(updatedPortfolio, price) };
      });
      setWaitingForSellCrossover(false);
    }
  }, [market.signal, waitingForSellCrossover]);

  // WebSockets Ticker updates
  useEffect(() => {
    let socket: WebSocket | undefined;
    let reconnectTimer: number | undefined;
    let closedByComponent = false;

    function connectTickerStream(streamIndex = 0) {
      setStreamStatus("connecting");
      const streamUrls = [
        `wss://stream.binance.com/ws/${market.symbol.replace("/", "").toLowerCase()}@ticker`
      ];
      const streamUrl = streamUrls[streamIndex] ?? streamUrls[0];
      socket = new WebSocket(streamUrl);

      socket.onopen = () => {
        setStreamStatus("live");
      };

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          let price = NaN;
          let changePct = NaN;

          if (data.e === "trade") {
            price = Number(data.p);
          } else if (data.e === "24hrTicker") {
            price = Number(data.c);
            changePct = Number(data.P);
          } else {
            price = Number(data.p ?? data.c);
            changePct = Number(data.P);
          }

          if (!Number.isFinite(price) || Number.isNaN(price)) {
            return;
          }

          setMarket((current) => ({
            ...current,
            price,
            changePct: Number.isFinite(changePct) && !Number.isNaN(changePct) ? changePct : current.changePct,
            updatedAt: new Date(data.E ?? data.T ?? Date.now()).toISOString(),
            portfolio: markPortfolioToMarket(current.portfolio, price)
          }));
        } catch (err) {
          console.error("Error parsing trade stream update:", err);
        }
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
  }, [market.source, market.symbol]);

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

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingConfig(true);
    setConfigSuccess(null);
    setConfigError(null);

    try {
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: formKey || undefined,
          apiSecret: formSecret || undefined,
          symbol: formSymbol,
          timeframe: formTimeframe,
          allottedBalance: Number(formBalance)
        })
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to update configuration.");
      }

      setConfigSuccess("Configuration saved and synchronized successfully!");
      setApiConfig((current) => ({
        ...current,
        symbol: formSymbol,
        timeframe: formTimeframe,
        allottedBalance: Number(formBalance),
        hasApiKey: formKey ? true : current.hasApiKey,
        hasApiSecret: formSecret ? true : current.hasApiSecret
      }));
      setFormKey("");
      setFormSecret("");
    } catch (err) {
      setConfigError(err instanceof Error ? err.message : "Failed to save configuration.");
    } finally {
      setIsSavingConfig(false);
    }
  };

  const handleManualBuy = () => {
    // Ensure we have USDT balance and bullish EMA setup
    setMarket((current) => {
      const hasCash = current.portfolio.cash > 0;
      const ema9 = current.latest.ema9;
      const ema21 = current.latest.ema21;
      const bullish = ema9 !== undefined && ema21 !== undefined && ema9 > ema21;
      if (!hasCash || !bullish) return current;

      const price = current.price;
      const btcAmount = current.portfolio.cash / price;
      const positionCost = current.portfolio.cash;
      const newTrade = {
        timestamp: new Date().toISOString(),
        side: "BUY" as const,
        price,
        amount: btcAmount,
        value: positionCost
      };

      const updatedPortfolio = {
        ...current.portfolio,
        isManual: true,
        cash: 0,
        btcAmount,
        entryPrice: price,
        positionCost,
        inPosition: true,
        lastTrade: newTrade,
        totalTrades: current.portfolio.totalTrades + 1,
        trades: [...current.portfolio.trades, newTrade]
      };

      // After manual buy we start waiting for a bearish crossover to sell immediately
      setWaitingForSellCrossover(true);
sendTelegramMessage(`🟢 BUY executed at $${price.toFixed(2)} for ${btcAmount.toFixed(6)} BTC`);

      return {
        ...current,
        portfolio: markPortfolioToMarket(updatedPortfolio, price)
      };
    });
  };

  const handleManualSell = () => {
    // Ensure we have a BTC position to sell
    const current = market;
    if (!current.portfolio.inPosition || current.portfolio.btcAmount <= 0) return;

    const price = current.price;
    const cashValue = current.portfolio.btcAmount * price;
    const profitLoss = cashValue - current.portfolio.positionCost;
    const profitLossPct = current.portfolio.positionCost > 0 ? (profitLoss / current.portfolio.positionCost) * 100 : 0;

    const newTrade = {
      timestamp: new Date().toISOString(),
      side: "SELL" as const,
      price,
      amount: current.portfolio.btcAmount,
      value: cashValue,
      profitLoss,
      profitLossPct
    };

    const updatedPortfolio = {
      ...current.portfolio,
      isManual: true,
      cash: cashValue,
      btcAmount: 0,
      entryPrice: null,
      positionCost: 0,
      inPosition: false,
      realizedProfitLoss: current.portfolio.realizedProfitLoss + profitLoss,
      totalTrades: current.portfolio.totalTrades + 1,
      trades: [...current.portfolio.trades, newTrade]
    };

    // Update market state with new portfolio
    setMarket((prev) => ({
      ...prev,
      portfolio: markPortfolioToMarket(updatedPortfolio, price)
    }));

    setWaitingForCrossover(true);
    sendTelegramMessage(`🔴 SELL executed at $${price.toFixed(2)} for ${current.portfolio.btcAmount.toFixed(6)} BTC, P/L: $${profitLoss.toFixed(2)} (${profitLossPct.toFixed(2)}%)`);
  };

  // Show balance via Telegram
  const handleShowBalance = () => {
    setMarket((current) => {
      const price = current.price;
      const btcValue = current.portfolio.btcAmount * price;
      const total = current.portfolio.cash + btcValue;
      const message = `💰 Current balance: $${total.toFixed(2)} (Cash: $${current.portfolio.cash.toFixed(2)}, BTC: ${current.portfolio.btcAmount.toFixed(6)} ≈ $${btcValue.toFixed(2)})`;
      sendTelegramMessage(message);
      return current;
    });
  };
  const handleResetPortfolio = () => {
    window.location.reload();
  };

  return (
    <div className="layout">
      <Sidebar activeTab={activeTab} onTabChange={(tab) => setActiveTab(tab as DashboardTab)} />

      <div className="main-content">
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
            <div className="dashboard-grid">
              {/* Main Content Column (Left) */}
              <div className="dashboard-main-col">
                {/* Top Market Ticker Strip */}
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

                {/* Main Content Area based on activeTab */}
                <div className="main-view-content" style={{ marginTop: "1.5rem" }}>
                  {activeTab === "chart" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
                      <StrategyChart candles={chartCandles} isLoadingOlder={isLoadingOlder} onLoadOlder={loadOlderCandles} />
                      <div className="card tab-body" style={{ padding: "1.5rem" }}>
                        <h4 style={{ margin: "0 0 1rem", fontSize: "1.1rem" }}>Interactive Chart Guide</h4>
                        <ul style={{ margin: 0, paddingLeft: "1.25rem", color: "var(--muted)", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                          <li><strong>Scroll / Swipe</strong>: Scroll up/down or swipe left/right to pan through history.</li>
                          <li><strong>Zoom</strong>: Use manual buttons at the top right, or hold <code>Ctrl</code> while scrolling.</li>
                          <li><strong>Crosshair</strong>: Hover over the chart to inspect prices, wicks, and indicator values at any point in time.</li>
                          <li><strong>Auto loading</strong>: Pan the chart all the way to the left to automatically load older history.</li>
                        </ul>
                      </div>
                    </div>
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

{/* EMA Proximity Speedometer */}
<InfoCard title="EMA Proximity" icon={<ArrowUpRight size={18} />}>
  <Speedometer ema9={market.latest.ema9} ema21={market.latest.ema21} />
</InfoCard>

                      <InfoCard title="Momentum" icon={<ShieldCheck size={18} />}>
                        <div className="metric-grid">
                          <Metric label="RSI 14" value={formatNumber(market.latest.rsi14, 1)} />
                          <Metric label="Volume" value={formatNumber(market.latest.volume, 2)} />
                          <Metric label="Vol SMA 20" value={formatNumber(market.latest.volumeSma20, 2)} />
                        </div>
                      </InfoCard>
                    </div>
                  )}

                  {activeTab === "history" && (
                    <InfoCard title="Trade History" icon={<Table2 size={18} />}>
                      <TradeHistory market={market} />
                    </InfoCard>
                  )}
                </div>
              </div>

              {/* Sidebar Widgets Column (Right) */}
              <div className="dashboard-sidebar-col">
                {/* Account strip card */}
                {/* EMA Proximity Speedometer */}
<InfoCard title="EMA Proximity" icon={<ArrowUpRight size={18} />}>
  <Speedometer ema9={market.latest.ema9} ema21={market.latest.ema21} />
</InfoCard>
<div className="card sidebar-card account-card">
                  <div className="card-head">
                    <h3>Account & Position</h3>
                    <span className={`position-badge ${market.portfolio.inPosition ? "active" : ""}`}>
                      {market.portfolio.inPosition ? "In Position" : "No Position"}
                    </span>
                  </div>
                  <div className="sidebar-metrics">
                    <Metric label="USDT Balance" value={`${formatUsd(market.portfolio.cash)}`} />
                    <Metric label="BTC Position" value={`${formatNumber(market.portfolio.btcAmount, 8)} BTC`} />
                    <Metric
                      label="Open PnL"
                      value={formatSignedUsd(market.portfolio.unrealizedProfitLoss)}
                      tone={market.portfolio.unrealizedProfitLoss >= 0 ? "positive" : "negative"}
                    />
                    <Metric label="Realized PnL" value={formatSignedUsd(market.portfolio.realizedProfitLoss)} tone={market.portfolio.realizedProfitLoss >= 0 ? "positive" : "negative"} />
                    <Metric label="Entry Price" value={market.portfolio.entryPrice ? formatUsd(market.portfolio.entryPrice) : "-"} />
                  </div>

                  <div className="trade-buttons" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", marginTop: "1rem" }}>
                    <button 
                      onClick={handleManualBuy} 
                      disabled={market.portfolio.inPosition || market.portfolio.cash <= 0}
                      className="button buy-btn"
                      style={{
                        background: "rgba(16, 185, 129, 0.12)",
                        borderColor: "rgba(16, 185, 129, 0.3)",
                        color: "#34d399",
                        cursor: "pointer",
                        padding: "0.5rem",
                        minHeight: "auto",
                        fontWeight: 600,
                        borderRadius: "8px",
                        textAlign: "center",
                        justifyContent: "center"
                      }}
                    >
                      BUY BTC
                    </button>
                    <button 
                      onClick={handleManualSell} 
                      disabled={!market.portfolio.inPosition}
                      className="button sell-btn"
                      style={{
                        background: "rgba(244, 63, 94, 0.12)",
                        borderColor: "rgba(244, 63, 94, 0.3)",
                        color: "#fb7185",
                        cursor: "pointer",
                        padding: "0.5rem",
                        minHeight: "auto",
                        fontWeight: 600,
                        borderRadius: "8px",
                        textAlign: "center",
                        justifyContent: "center"
                      }}
                    >
                      SELL BTC
                    </button>

                    {(market.portfolio as any).isManual && (
                      <button 
                        onClick={handleResetPortfolio} 
                        className="button reset-btn"
                        style={{
                          gridColumn: "span 2",
                          marginTop: "0.5rem",
                          background: "transparent",
                          border: "none",
                          color: "var(--muted)",
                          fontSize: "0.76rem",
                          textDecoration: "underline",
                          cursor: "pointer",
                          padding: 0,
                          minHeight: "auto",
                          display: "flex",
                          justifyContent: "center"
                        }}
                      >
                        Reset to Auto
                      </button>
                    )}
                  </div>
                </div>

                {/* Entry Checklist card */}
                <div className="card sidebar-card checklist-card">
                  <div className="card-head">
                    <h3>Entry Checklist</h3>
                    <span className="pill"><ListChecks size={16} /></span>
                  </div>
                  <div className="checklist">
                    {market.conditions.map((condition) => (
                      <div className="check" key={condition.label}>
                        {condition.passed ? <CheckCircle2 className="ok" size={18} /> : <XCircle className="no" size={18} />}
                        <span>{condition.label}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Exit rules card */}
                <div className="card sidebar-card exit-rules-card">
                  <div className="card-head">
                    <h3>Exit Rules</h3>
                    <span className="pill"><ArrowDownRight size={16} /></span>
                  </div>
                  <div className="checklist">
                    <div className="check">
                      <CircleAlert className={market.signal === "SELL" ? "ok" : "muted"} size={18} />
                      <span>EMA 9 crossed below EMA 21 (Option B confirmed)</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
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
    <section className="card card-inner">
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

// API Management Form component
function ApiManagementTab({
  apiConfig,
  formKey,
  setFormKey,
  formSecret,
  setFormSecret,
  formSymbol,
  setFormSymbol,
  formTimeframe,
  setFormTimeframe,
  formBalance,
  setFormBalance,
  isSaving,
  onSave,
  successMsg,
  errorMsg
}: {
  apiConfig: any;
  formKey: string;
  setFormKey: (v: string) => void;
  formSecret: string;
  setFormSecret: (v: string) => void;
  formSymbol: string;
  setFormSymbol: (v: string) => void;
  formTimeframe: string;
  setFormTimeframe: (v: string) => void;
  formBalance: string;
  setFormBalance: (v: string) => void;
  isSaving: boolean;
  onSave: (e: React.FormEvent) => void;
  successMsg: string | null;
  errorMsg: string | null;
}) {
  return (
    <div className="api-tab-content">
      <div className="api-config-summary">
        <h4>Binance Connection Status</h4>
        <div className="status-grid">
          <div className="status-cell">
            <span>Binance Keys</span>
            <strong className={apiConfig.hasApiKey ? "positive-text" : "negative-text"}>
              {apiConfig.hasApiKey ? "Connected" : "Disconnected"}
            </strong>
          </div>
          <div className="status-cell">
            <span>Active Trading Pair</span>
            <strong style={{ color: "var(--amber)" }}>{apiConfig.symbol}</strong>
          </div>
          <div className="status-cell">
            <span>Interval Timeframe</span>
            <strong>{apiConfig.timeframe}</strong>
          </div>
          <div className="status-cell">
            <span>Allotted Capital</span>
            <strong style={{ color: "var(--green)" }}>{formatUsd(apiConfig.allottedBalance)}</strong>
          </div>
        </div>
      </div>

      <div className="api-form-card">
        <form onSubmit={onSave} className="api-form">
          <div className="form-header">
            <h4>Configure API Connection</h4>
            <p>Update your credentials, target asset, timeframe intervals, and capital allocation.</p>
          </div>

          <div className="form-group">
            <label htmlFor="apiKey">Binance API Key</label>
            <input
              id="apiKey"
              type="password"
              placeholder={apiConfig.hasApiKey ? "•••••••••••••••• (Leave blank to keep existing)" : "Enter Binance API Key"}
              value={formKey}
              onChange={(e) => setFormKey(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label htmlFor="apiSecret">Binance API Secret</label>
            <input
              id="apiSecret"
              type="password"
              placeholder={apiConfig.hasApiSecret ? "•••••••••••••••• (Leave blank to keep existing)" : "Enter Binance API Secret"}
              value={formSecret}
              onChange={(e) => setFormSecret(e.target.value)}
            />
          </div>

          <div className="form-row-grid">
            <div className="form-group">
              <label htmlFor="coinName">Coin / Trading Pair</label>
              <select
                id="coinName"
                value={formSymbol}
                onChange={(e) => setFormSymbol(e.target.value)}
              >
                <option value="BTC/USDT">BTC/USDT</option>
                <option value="ETH/USDT">ETH/USDT</option>
                <option value="SOL/USDT">SOL/USDT</option>
                <option value="BNB/USDT">BNB/USDT</option>
                <option value="XRP/USDT">XRP/USDT</option>
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="timeframe">Timeframe</label>
              <select
                id="timeframe"
                value={formTimeframe}
                onChange={(e) => setFormTimeframe(e.target.value)}
              >
                <option value="1m">1m</option>
                <option value="5m">5m</option>
                <option value="15m">15m</option>
                <option value="1h">1h</option>
                <option value="4h">4h</option>
                <option value="1d">1d</option>
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="balance">Allotted Balance (USDT)</label>
              <input
                id="balance"
                type="number"
                min="10"
                value={formBalance}
                onChange={(e) => setFormBalance(e.target.value)}
              />
            </div>
          </div>

          {successMsg && <div className="form-msg success">{successMsg}</div>}
          {errorMsg && <div className="form-msg error">{errorMsg}</div>}

          <button type="submit" className="button submit-btn" disabled={isSaving}>
            {isSaving ? "Saving Configuration..." : "Save & Sync Configuration"}
          </button>
        </form>
      </div>
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



function formatSignedUsd(value: number) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatUsd(value)}`;
}

function formatSignedPct(value: number) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}
