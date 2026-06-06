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
};

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

  return {
    symbol: "BTC/USDT",
    timeframe: "15m",
    price: latest.close,
    changePct,
    signal,
    reason,
    updatedAt: new Date().toISOString(),
    latest,
    previous,
    conditions,
    candles: enriched.slice(-8),
    chartCandles: enriched.slice(-120)
  };
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
