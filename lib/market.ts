export type Candle = {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  ema9?: number;
  ema21?: number;
  ema200?: number;
  rsi14?: number;
  volumeSma20?: number;
};

export type StrategySnapshot = {
  symbol: "BTC/USDT";
  timeframe: "15m";
  source: string;
  price: number;
  changePct: number;
  signal: "BUY" | "SELL" | "HOLD";
  reason: string;
  updatedAt: string;
  latest: Candle;
  previous: Candle;
  conditions: Array<{ label: string; passed: boolean }>;
  candles: Candle[];
  chartCandles: Candle[];
  portfolio: PortfolioSnapshot;
};

export type PortfolioSnapshot = {
  initialCapital: number;
  cash: number;
  btcAmount: number;
  entryPrice: number | null;
  positionCost: number;
  currentValue: number;
  profitLoss: number;
  profitLossPct: number;
  realizedProfitLoss: number;
  unrealizedProfitLoss: number;
  inPosition: boolean;
  lastTrade: SimulatedTrade | null;
  totalTrades: number;
  trades: SimulatedTrade[];
};

export type SimulatedTrade = {
  timestamp: string;
  side: "BUY" | "SELL";
  price: number;
  amount: number;
  value: number;
  profitLoss?: number;
  profitLossPct?: number;
};

const INITIAL_CAPITAL = 100000;

export function enrichCandles(candles: Candle[]): Candle[] {
  const closes = candles.map((candle) => candle.close);
  const volumes = candles.map((candle) => candle.volume);
  const ema9 = ema(closes, 9);
  const ema21 = ema(closes, 21);
  const ema200 = ema(closes, 200);
  const rsi14 = rsi(closes, 14);
  const volumeSma20 = sma(volumes, 20);

  return candles.map((candle, index) => ({
    ...candle,
    ema9: ema9[index],
    ema21: ema21[index],
    ema200: ema200[index],
    rsi14: rsi14[index],
    volumeSma20: volumeSma20[index]
  }));
}

export function buildSnapshot(candles: Candle[]): StrategySnapshot {
  if (candles.length < 201) {
    throw new Error("At least 201 closed candles are required for EMA 200 strategy data.");
  }

  const enriched = enrichCandles(candles);
  const latest = enriched[enriched.length - 1];
  const previous = enriched[enriched.length - 2];

  const crossedUp = value(previous.ema9) <= value(previous.ema21) && value(latest.ema9) > value(latest.ema21);
  const crossedDown = value(previous.ema9) >= value(previous.ema21) && value(latest.ema9) < value(latest.ema21);
  const conditions = [
    { label: "Price above EMA 200", passed: latest.close > value(latest.ema200) },
    { label: "EMA 9 crossed above EMA 21", passed: crossedUp },
    { label: "RSI 14 greater than 55", passed: value(latest.rsi14) > 55 },
    { label: "Close above EMA 9 and EMA 21", passed: latest.close > value(latest.ema9) && latest.close > value(latest.ema21) },
    { label: "Volume above SMA 20", passed: latest.volume > value(latest.volumeSma20) }
  ];

  let signal: StrategySnapshot["signal"] = "HOLD";
  let reason = "Waiting for all BTC/USDT long-entry confirmations.";

  if (conditions.every((condition) => condition.passed)) {
    signal = "BUY";
    reason = "All BTC/USDT entry conditions are aligned.";
  } else if (crossedDown || value(latest.rsi14) < 45) {
    signal = "SELL";
    reason = crossedDown ? "EMA 9 crossed below EMA 21." : "RSI 14 fell below 45.";
  }

  const open24h = enriched[Math.max(0, enriched.length - 96)]?.close ?? latest.close;
  const changePct = ((latest.close - open24h) / open24h) * 100;
  const portfolio = simulatePortfolio(enriched, latest.close);

  return {
    symbol: "BTC/USDT",
    timeframe: "15m",
    source: "Binance",
    price: latest.close,
    changePct,
    signal,
    reason,
    updatedAt: new Date().toISOString(),
    latest,
    previous,
    conditions,
    candles: enriched.slice(-8),
    chartCandles: enriched.filter((candle) => candle.ema200 !== undefined).slice(-220),
    portfolio
  };
}

export function withPortfolioPrice(snapshot: StrategySnapshot, price: number): StrategySnapshot {
  return {
    ...snapshot,
    portfolio: markPortfolioToMarket(snapshot.portfolio, price)
  };
}

function simulatePortfolio(candles: Candle[], currentPrice: number): PortfolioSnapshot {
  let cash = INITIAL_CAPITAL;
  let btcAmount = 0;
  let entryPrice: number | null = null;
  let positionCost = 0;
  let stopLoss: number | null = null;
  let trailingStop: number | null = null;
  let realizedProfitLoss = 0;
  const trades: SimulatedTrade[] = [];

  for (let index = 201; index < candles.length; index += 1) {
    const latest = candles[index];
    const previous = candles[index - 1];

    if (btcAmount > 0 && stopLoss !== null) {
      const nextTrailingStop = Math.max(trailingStop ?? stopLoss, value(latest.ema21));
      trailingStop = Math.min(nextTrailingStop, latest.close);
      stopLoss = Math.max(stopLoss, trailingStop);
    }

    const signal = evaluateCandleSignal(previous, latest, btcAmount > 0);

    if (signal === "BUY" && btcAmount === 0 && cash > 0) {
      btcAmount = cash / latest.close;
      positionCost = cash;
      entryPrice = latest.close;
      stopLoss = recentSwingLow(candles.slice(0, index + 1), 10, 0.001);
      trailingStop = null;
      trades.push({
        timestamp: latest.timestamp,
        side: "BUY",
        price: latest.close,
        amount: btcAmount,
        value: positionCost
      });
      cash = 0;
      continue;
    }

    const stopExitPrice = stopLoss !== null && latest.low <= stopLoss ? stopLoss : null;
    const trailingExitPrice = trailingStop !== null && latest.close <= trailingStop ? trailingStop : null;
    const exitPrice = stopExitPrice ?? trailingExitPrice ?? (signal === "SELL" ? latest.close : null);

    if (exitPrice !== null && btcAmount > 0 && entryPrice !== null) {
      const exit = closePosition(latest.timestamp, exitPrice, btcAmount, positionCost);
      cash = exit.cash;
      realizedProfitLoss += exit.profitLoss;
      trades.push(exit.trade);
      btcAmount = 0;
      entryPrice = null;
      positionCost = 0;
      stopLoss = null;
      trailingStop = null;
    }
  }

  return markPortfolioToMarket(
    {
      initialCapital: INITIAL_CAPITAL,
      cash,
      btcAmount,
      entryPrice,
      positionCost,
      currentValue: cash,
      profitLoss: cash - INITIAL_CAPITAL,
      profitLossPct: ((cash - INITIAL_CAPITAL) / INITIAL_CAPITAL) * 100,
      realizedProfitLoss,
      unrealizedProfitLoss: 0,
      inPosition: btcAmount > 0,
      lastTrade: trades[trades.length - 1] ?? null,
      totalTrades: trades.length,
      trades: trades.slice(-12)
    },
    currentPrice
  );
}

function markPortfolioToMarket(portfolio: PortfolioSnapshot, currentPrice: number): PortfolioSnapshot {
  const currentValue = portfolio.cash + portfolio.btcAmount * currentPrice;
  const profitLoss = currentValue - portfolio.initialCapital;
  const unrealizedProfitLoss =
    portfolio.btcAmount > 0 ? portfolio.btcAmount * currentPrice - portfolio.positionCost : 0;

  return {
    ...portfolio,
    currentValue,
    profitLoss,
    profitLossPct: portfolio.initialCapital > 0 ? (profitLoss / portfolio.initialCapital) * 100 : 0,
    unrealizedProfitLoss
  };
}

function evaluateCandleSignal(previous: Candle, latest: Candle, inPosition: boolean): "BUY" | "SELL" | "HOLD" {
  const crossedUp = value(previous.ema9) <= value(previous.ema21) && value(latest.ema9) > value(latest.ema21);
  const crossedDown = value(previous.ema9) >= value(previous.ema21) && value(latest.ema9) < value(latest.ema21);

  if (inPosition && (crossedDown || value(latest.rsi14) < 45)) {
    return "SELL";
  }

  const buyConditions = [
    latest.close > value(latest.ema200),
    crossedUp,
    value(latest.rsi14) > 55,
    latest.close > value(latest.ema9) && latest.close > value(latest.ema21),
    latest.volume > value(latest.volumeSma20)
  ];

  return buyConditions.every(Boolean) ? "BUY" : "HOLD";
}

function closePosition(timestamp: string, price: number, amount: number, positionCost: number) {
  const cash = amount * price;
  const profitLoss = cash - positionCost;
  const profitLossPct = positionCost > 0 ? (profitLoss / positionCost) * 100 : 0;
  return {
    cash,
    profitLoss,
    trade: {
      timestamp,
      side: "SELL" as const,
      price,
      amount,
      value: cash,
      profitLoss,
      profitLossPct
    }
  };
}

function recentSwingLow(candles: Candle[], lookback: number, bufferPct: number): number {
  const recent = candles.slice(-lookback);
  const swingLow = Math.min(...recent.map((candle) => candle.low));
  return swingLow * (1 - bufferPct);
}

function ema(values: number[], period: number): Array<number | undefined> {
  const multiplier = 2 / (period + 1);
  const output: Array<number | undefined> = Array(values.length).fill(undefined);
  let previousEma: number | undefined;

  values.forEach((price, index) => {
    if (index < period - 1) {
      return;
    }

    if (index === period - 1) {
      previousEma = average(values.slice(0, period));
    } else if (previousEma !== undefined) {
      previousEma = (price - previousEma) * multiplier + previousEma;
    }

    output[index] = previousEma;
  });

  return output;
}

function sma(values: number[], period: number): Array<number | undefined> {
  return values.map((_, index) => {
    if (index < period - 1) {
      return undefined;
    }
    return average(values.slice(index - period + 1, index + 1));
  });
}

function rsi(values: number[], period: number): Array<number | undefined> {
  const output: Array<number | undefined> = Array(values.length).fill(undefined);
  let avgGain = 0;
  let avgLoss = 0;

  for (let index = 1; index < values.length; index += 1) {
    const change = values[index] - values[index - 1];
    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);

    if (index <= period) {
      avgGain += gain;
      avgLoss += loss;
      if (index === period) {
        avgGain /= period;
        avgLoss /= period;
        output[index] = rsiFromAverages(avgGain, avgLoss);
      }
      continue;
    }

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    output[index] = rsiFromAverages(avgGain, avgLoss);
  }

  return output;
}

function rsiFromAverages(avgGain: number, avgLoss: number): number {
  if (avgLoss === 0) {
    return 100;
  }
  const relativeStrength = avgGain / avgLoss;
  return 100 - 100 / (1 + relativeStrength);
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function value(input: number | undefined): number {
  return input ?? Number.NaN;
}

export function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value > 1000 ? 0 : 2
  }).format(value);
}

export function formatNumber(value: number | undefined, digits = 2): string {
  if (value === undefined || Number.isNaN(value)) {
    return "-";
  }
  return value.toFixed(digits);
}
