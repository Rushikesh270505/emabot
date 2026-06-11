// app/components/BacktestPanel.tsx
"use client";

import { useState, useEffect } from "react";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { runBacktest, BacktestResult, SimulatedTrade } from "../lib/backtest";

import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceDot } from "recharts";

interface BacktestPanelProps {
  market: any; // StrategySnapshot – we only need symbol and timeframe for fetching candles
}

export function BacktestPanel({ market }: BacktestPanelProps) {
  const [startDate, setStartDate] = useState<Date | undefined>(undefined);
  const [endDate, setEndDate] = useState<Date | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [candles, setCandles] = useState<Array<any>>([]);

  const handleRun = async () => {
    if (!startDate || !endDate) return;
    setLoading(true);
    try {
      // fetch historic candles for the selected range
      const params = new URLSearchParams({
        source: market.source,
        startTime: String(startDate.getTime()),
        endTime: String(endDate.getTime())
      });
      const res = await fetch(`/api/candles?${params.toString()}`);
      const payload = await res.json();
      const historicCandles = payload.candles; // assume format matches Candle[] used by backtest
      const resBacktest = runBacktest(historicCandles, startDate.toISOString().split("T")[0], endDate.toISOString().split("T")[0]);
      setResult(resBacktest);
      setCandles(historicCandles);
    } catch (e) {
      console.error("Backtest error", e);
    } finally {
      setLoading(false);
    }
  };

  // Helper to format trade markers for the chart
  const tradeMarkers = result?.trades.map((t) => {
    const candle = candles.find((c) => new Date(c.timestamp).toISOString().split("T")[0] === new Date(t.timestamp).toISOString().split("T")[0]);
    if (!candle) return null;
    return {
      ...candle,
      type: t.side,
      price: t.price
    };
  }).filter(Boolean);

  return (
    <div className="card backtest-panel" style={{ padding: "1.5rem", marginTop: "1rem" }}>
      <h3>Backtesting</h3>
      <div className="date-pickers" style={{ display: "flex", gap: "1rem", alignItems: "center", marginBottom: "1rem" }}>
        <label>
          Start:
          <DatePicker selected={startDate} onChange={(d: Date | null) => setStartDate(d ?? undefined)} maxDate={endDate || new Date()} dateFormat="yyyy-MM-dd" />
        </label>
        <label>
          End:
          <DatePicker selected={endDate} onChange={(d: Date | null) => setEndDate(d ?? undefined)} minDate={startDate} maxDate={new Date()} dateFormat="yyyy-MM-dd" />
        </label>
        <button onClick={handleRun} disabled={!startDate || !endDate || loading} className="button" style={{ padding: "0.5rem 1rem" }}>
          {loading ? "Running..." : "Run Backtest"}
        </button>
      </div>

      {result && (
        <div className="backtest-results" style={{ marginTop: "1rem" }}>
          <h4>Summary</h4>
          <ul>
            <li>Final Cash: ${result.finalCash.toFixed(2)}</li>
            <li>Final BTC: {result.finalBtc.toFixed(6)}</li>
            <li>Total Value: ${result.totalValue.toFixed(2)}</li>
            <li>Profit/Loss: ${result.profitLoss.toFixed(2)} ({result.profitLossPct.toFixed(2)}%)</li>
            <li>Win Rate: {result.winRate.toFixed(2)}%</li>
            <li>Total Trades: {result.trades.length}</li>
          </ul>
          <h4>Trade Log</h4>
          <div style={{ maxHeight: "300px", overflowY: "auto" }}>
            <table className="trade-table" style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Side</th>
                  <th>Price</th>
                  <th>BTC Amount</th>
                  <th>P/L ($)</th>
                </tr>
              </thead>
              <tbody>
                {result.trades.map((t, i) => (
                  <tr key={i} style={{ background: i % 2 === 0 ? "var(--bg-muted)" : "transparent" }}>
                    <td>{new Date(t.timestamp).toLocaleString()}</td>
                    <td>{t.side}</td>
                    <td>${t.price.toFixed(2)}</td>
                    <td>{t.btcAmount.toFixed(6)}</td>
                    <td>{t.profitLoss !== undefined ? `${t.profitLoss.toFixed(2)} (${t.profitLossPct?.toFixed(2)}%)` : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h4>Price Chart with Trades</h4>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={candles} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
              <XAxis dataKey="timestamp" tickFormatter={(t) => new Date(t).toLocaleDateString()} />
              <YAxis domain={['dataMin', 'dataMax']} />
              <Tooltip labelFormatter={(t) => new Date(t).toLocaleString()} />
              <Line type="monotone" dataKey="close" stroke="#8884d8" dot={false} />
              {tradeMarkers && tradeMarkers.map((m, idx) => (
                <ReferenceDot
                  key={idx}
                  x={m.timestamp}
                  y={m.price}
                  r={5}
                  fill={m.type === "BUY" ? "green" : "red"}
                  stroke="none"
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
