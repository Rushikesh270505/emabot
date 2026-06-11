// app/lib/backtest.ts
// Define minimal types for backtesting
interface Candle {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// Simple EMA calculation
function calcEMA(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const ema: number[] = [];
  let prev = values[0];
  ema.push(prev);
  for (let i = 1; i < values.length; i++) {
    const val = values[i];
    const cur = val * k + prev * (1 - k);
    ema.push(cur);
    prev = cur;
  }
  return ema;
}

// Placeholder for StrategySnapshot (not used directly in backtest)
type StrategySnapshot = any;



export interface SimulatedTrade {
  timestamp: string;
  side: "BUY" | "SELL";
  price: number;
  btcAmount: number;
  cashAfter: number;
  btcAfter: number;
  profitLoss?: number; // only for SELL
  profitLossPct?: number;
}

export interface BacktestResult {
  finalCash: number;
  finalBtc: number;
  totalValue: number;
  profitLoss: number;
  profitLossPct: number;
  winRate: number; // percentage of profitable sells
  trades: SimulatedTrade[];
}

/**
 * Run an EMA‑9 / EMA‑21 crossover backtest on a set of candles.
 * @param candles Full candle array (chronological order, oldest first).
 * @param startDate ISO string "YYYY-MM-DD" – inclusive.
 * @param endDate   ISO string – inclusive.
 * @param initialCash Starting cash, default $100 000.
 */
export function runBacktest(
  candles: Candle[],
  startDate: string,
  endDate: string,
  initialCash = 100_000,
): BacktestResult {
  // Filter candles by date range.
  const start = new Date(startDate);
  const end = new Date(endDate);
  const filtered = candles.filter((c) => {
    const d = new Date(c.timestamp);
    return d >= start && d <= end;
  });

  // Prepare EMA series.
  const closePrices = filtered.map((c) => c.close);
  const ema9 = calcEMA(closePrices, 9);
  const ema21 = calcEMA(closePrices, 21);

  // Portfolio state.
  let cash = initialCash;
  let btc = 0;
  let positionCost = 0;
  let inPosition = false;
  const trades: SimulatedTrade[] = [];
  let wins = 0;

  for (let i = 0; i < filtered.length; i++) {
    const price = filtered[i].close;
    const ts = filtered[i].timestamp;
    const e9 = ema9[i];
    const e21 = ema21[i];
    const prevE9 = i > 0 ? ema9[i - 1] : undefined;
    const prevE21 = i > 0 ? ema21[i - 1] : undefined;

    // Detect bullish crossover: previous e9 <= e21 && current e9 > e21
    const bullishCross =
      prevE9 !== undefined &&
      prevE21 !== undefined &&
      prevE9 <= prevE21 &&
      e9 !== undefined &&
      e21 !== undefined &&
      e9 > e21;

    // Detect bearish crossover: previous e9 >= e21 && current e9 < e21
    const bearishCross =
      prevE9 !== undefined &&
      prevE21 !== undefined &&
      prevE9 >= prevE21 &&
      e9 !== undefined &&
      e21 !== undefined &&
      e9 < e21;

    if (!inPosition && cash > 0 && bullishCross) {
      // BUY
      const btcAmt = cash / price;
      const trade: SimulatedTrade = {
        timestamp: ts,
        side: "BUY",
        price,
        btcAmount: btcAmt,
        cashAfter: 0,
        btcAfter: btcAmt,
      };
      trades.push(trade);
      positionCost = cash;
      cash = 0;
      btc = btcAmt;
      inPosition = true;
    } else if (inPosition && bearishCross) {
      // SELL
      const cashValue = btc * price;
      const profitLoss = cashValue - positionCost;
      const profitLossPct = positionCost > 0 ? (profitLoss / positionCost) * 100 : 0;
      if (profitLoss > 0) wins++;
      const trade: SimulatedTrade = {
        timestamp: ts,
        side: "SELL",
        price,
        btcAmount: btc,
        cashAfter: cashValue,
        btcAfter: 0,
        profitLoss,
        profitLossPct,
      };
      trades.push(trade);
      cash = cashValue;
      btc = 0;
      inPosition = false;
      positionCost = 0;
    }
  }

  const lastPrice = filtered.length ? filtered[filtered.length - 1].close : 0;
  const totalValue = cash + btc * lastPrice;
  const profitLoss = totalValue - initialCash;
  const profitLossPct = initialCash > 0 ? (profitLoss / initialCash) * 100 : 0;
  const winRate = trades.filter((t) => t.side === "SELL").length
    ? (wins / trades.filter((t) => t.side === "SELL").length) * 100
    : 0;

  return {
    finalCash: cash,
    finalBtc: btc,
    totalValue,
    profitLoss,
    profitLossPct,
    winRate,
    trades,
  };
}
