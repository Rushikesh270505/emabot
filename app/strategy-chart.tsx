"use client";

import { BarChart3 } from "lucide-react";
import { useEffect, useRef } from "react";
import { formatNumber, formatUsd, type Candle } from "@/lib/market";

type PointKey = "close" | "ema9" | "ema21" | "ema200";

const MIN_WIDTH = 1100;
const CANDLE_SPACING = 12;
const PRICE_HEIGHT = 360;
const RSI_HEIGHT = 130;
const VOLUME_HEIGHT = 120;
const GAP = 28;
const TOTAL_HEIGHT = PRICE_HEIGHT + RSI_HEIGHT + VOLUME_HEIGHT + GAP * 2;
const PAD_X = 46;
const PAD_TOP = 24;
const PAD_BOTTOM = 24;

export function StrategyChart({
  candles,
  isLoadingOlder,
  onLoadOlder
}: {
  candles: Candle[];
  isLoadingOlder: boolean;
  onLoadOlder: () => void;
}) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const didInitialScroll = useRef(false);
  const previousLength = useRef(candles.length);
  const visible = candles.filter((candle) => candle.ema200 !== undefined);
  const series = visible.length > 10 ? visible : candles;
  const width = Math.max(MIN_WIDTH, PAD_X * 2 + series.length * CANDLE_SPACING);
  const priceValues = series.flatMap((candle) => [
    candle.high,
    candle.low,
    candle.close,
    candle.ema9,
    candle.ema21,
    candle.ema200
  ]).filter(isNumber);
  const minPrice = Math.min(...priceValues);
  const maxPrice = Math.max(...priceValues);
  const maxVolume = Math.max(...series.map((candle) => candle.volume));

  const xFor = (index: number) => PAD_X + index * CANDLE_SPACING;
  const priceY = (value: number) => scale(value, minPrice, maxPrice, PRICE_HEIGHT - PAD_BOTTOM, PAD_TOP);
  const rsiY = (value: number) => PRICE_HEIGHT + GAP + scale(value, 0, 100, RSI_HEIGHT - PAD_BOTTOM, PAD_TOP);
  const volumeY = (value: number) =>
    PRICE_HEIGHT + GAP + RSI_HEIGHT + GAP + scale(value, 0, maxVolume, VOLUME_HEIGHT - PAD_BOTTOM, PAD_TOP);
  const volumeBase = PRICE_HEIGHT + GAP + RSI_HEIGHT + GAP + VOLUME_HEIGHT - PAD_BOTTOM;
  const candleWidth = 7;

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || didInitialScroll.current) {
      return;
    }
    scroller.scrollLeft = scroller.scrollWidth;
    didInitialScroll.current = true;
  }, []);

  useEffect(() => {
    const scroller = scrollerRef.current;
    const addedCandles = candles.length - previousLength.current;
    if (scroller && didInitialScroll.current && addedCandles > 0) {
      scroller.scrollLeft += addedCandles * CANDLE_SPACING;
    }
    previousLength.current = candles.length;
  }, [candles.length]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) {
      return;
    }

    function handleScroll() {
      const currentScroller = scrollerRef.current;
      if (currentScroller && currentScroller.scrollLeft < 140 && !isLoadingOlder) {
        onLoadOlder();
      }
    }

    scroller.addEventListener("scroll", handleScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", handleScroll);
  }, [isLoadingOlder, onLoadOlder]);

  return (
    <section className="chart-panel">
      <div className="chart-head">
        <div>
          <h3>BTC/USDT Strategy Chart</h3>
          <p>15 minute closed candles with EMA 9, EMA 21, EMA 200, RSI 14, and Volume SMA 20</p>
        </div>
        <span className="pill">
          <BarChart3 size={15} />
          {isLoadingOlder ? "Loading history" : `${series.length} candles`}
        </span>
      </div>

      <div className="legend">
        <LegendItem color="#eef3f7" label="Close" />
        <LegendItem color="#3ddc97" label="EMA 9" />
        <LegendItem color="#6aa8ff" label="EMA 21" />
        <LegendItem color="#f6c453" label="EMA 200" />
        <LegendItem color="#b58cff" label="RSI 14" />
        <LegendItem color="#8bd3dd" label="Volume SMA 20" />
      </div>

      <div className="chart-scroll" ref={scrollerRef}>
        <svg className="chart" style={{ width }} viewBox={`0 0 ${width} ${TOTAL_HEIGHT}`} role="img" aria-label="BTC strategy indicator chart">
          <defs>
            <linearGradient id="priceFill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#3ddc97" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#3ddc97" stopOpacity="0" />
            </linearGradient>
          </defs>

          <PanelGrid y={0} height={PRICE_HEIGHT} width={width} />
          <PanelGrid y={PRICE_HEIGHT + GAP} height={RSI_HEIGHT} width={width} />
          <PanelGrid y={PRICE_HEIGHT + GAP + RSI_HEIGHT + GAP} height={VOLUME_HEIGHT} width={width} />

          <PriceLabels min={minPrice} max={maxPrice} yFor={priceY} width={width} />
          <RsiGuide yFor={rsiY} width={width} />

          <path
            d={`${linePath(series, xFor, priceY, "close")} L ${xFor(series.length - 1)} ${PRICE_HEIGHT - PAD_BOTTOM} L ${xFor(0)} ${PRICE_HEIGHT - PAD_BOTTOM} Z`}
            fill="url(#priceFill)"
          />

          {series.map((candle, index) => {
            const x = xFor(index);
            const up = candle.close >= candle.open;
            const bodyTop = priceY(Math.max(candle.open, candle.close));
            const bodyBottom = priceY(Math.min(candle.open, candle.close));
            const color = up ? "#3ddc97" : "#ff5c7a";
            return (
              <g key={candle.timestamp}>
                <line x1={x} x2={x} y1={priceY(candle.high)} y2={priceY(candle.low)} stroke={color} strokeWidth="1.2" />
                <rect
                  x={x - candleWidth / 2}
                  y={bodyTop}
                  width={candleWidth}
                  height={Math.max(2, bodyBottom - bodyTop)}
                  rx="1.5"
                  fill={color}
                  opacity="0.9"
                />
              </g>
            );
          })}

          <SeriesPath candles={series} xFor={xFor} yFor={priceY} field="close" color="#eef3f7" width={1.7} />
          <SeriesPath candles={series} xFor={xFor} yFor={priceY} field="ema9" color="#3ddc97" width={2.2} />
          <SeriesPath candles={series} xFor={xFor} yFor={priceY} field="ema21" color="#6aa8ff" width={2.2} />
          <SeriesPath candles={series} xFor={xFor} yFor={priceY} field="ema200" color="#f6c453" width={2.2} />

          <line x1={PAD_X} x2={width - PAD_X} y1={rsiY(70)} y2={rsiY(70)} stroke="#ff5c7a" strokeDasharray="5 7" opacity="0.55" />
          <line x1={PAD_X} x2={width - PAD_X} y1={rsiY(55)} y2={rsiY(55)} stroke="#3ddc97" strokeDasharray="5 7" opacity="0.4" />
          <line x1={PAD_X} x2={width - PAD_X} y1={rsiY(45)} y2={rsiY(45)} stroke="#f6c453" strokeDasharray="5 7" opacity="0.4" />
          <line x1={PAD_X} x2={width - PAD_X} y1={rsiY(30)} y2={rsiY(30)} stroke="#6aa8ff" strokeDasharray="5 7" opacity="0.45" />
          <path d={rsiPath(series, xFor, rsiY)} fill="none" stroke="#b58cff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />

          {series.map((candle, index) => {
            const x = xFor(index);
            const barTop = volumeY(candle.volume);
            const color = candle.close >= candle.open ? "#3ddc97" : "#ff5c7a";
            return (
              <rect
                key={`volume-${candle.timestamp}`}
                x={x - candleWidth / 2}
                y={barTop}
                width={candleWidth}
                height={Math.max(1, volumeBase - barTop)}
                rx="1.5"
                fill={color}
                opacity="0.42"
              />
            );
          })}
          <path d={volumeSmaPath(series, xFor, volumeY)} fill="none" stroke="#8bd3dd" strokeWidth="2" strokeLinecap="round" />

          <text x={PAD_X} y={PRICE_HEIGHT + 16} fill="#94a3b8" fontSize="12">Price</text>
          <text x={PAD_X} y={PRICE_HEIGHT + GAP + 16} fill="#94a3b8" fontSize="12">RSI 14</text>
          <text x={PAD_X} y={PRICE_HEIGHT + GAP + RSI_HEIGHT + GAP + 16} fill="#94a3b8" fontSize="12">Volume</text>
        </svg>
      </div>

      <div className="chart-stats">
        <Metric label="Latest Close" value={formatUsd(series[series.length - 1]?.close ?? 0)} />
        <Metric label="EMA 9 / 21" value={`${formatUsdValue(series[series.length - 1]?.ema9)} / ${formatUsdValue(series[series.length - 1]?.ema21)}`} />
        <Metric label="RSI 14" value={formatNumber(series[series.length - 1]?.rsi14, 1)} />
        <Metric label="Volume SMA 20" value={formatNumber(series[series.length - 1]?.volumeSma20, 2)} />
      </div>
    </section>
  );
}

function PanelGrid({ y, height, width }: { y: number; height: number; width: number }) {
  return (
    <g>
      <rect x="18" y={y} width={width - 36} height={height} rx="8" fill="rgba(255,255,255,0.018)" stroke="rgba(148,163,184,0.14)" />
      {[0.25, 0.5, 0.75].map((tick) => (
        <line key={tick} x1={PAD_X} x2={width - PAD_X} y1={y + height * tick} y2={y + height * tick} stroke="rgba(148,163,184,0.12)" />
      ))}
    </g>
  );
}

function PriceLabels({ min, max, yFor, width }: { min: number; max: number; yFor: (value: number) => number; width: number }) {
  return (
    <g>
      {[min, (min + max) / 2, max].map((value) => (
        <text key={value} x={width - PAD_X + 8} y={yFor(value) + 4} fill="#94a3b8" fontSize="11">
          {formatUsd(value)}
        </text>
      ))}
    </g>
  );
}

function RsiGuide({ yFor, width }: { yFor: (value: number) => number; width: number }) {
  return (
    <g>
      {[70, 55, 45, 30].map((value) => (
        <text key={value} x={width - PAD_X + 8} y={yFor(value) + 4} fill="#94a3b8" fontSize="11">
          {value}
        </text>
      ))}
    </g>
  );
}

function SeriesPath({
  candles,
  xFor,
  yFor,
  field,
  color,
  width
}: {
  candles: Candle[];
  xFor: (index: number) => number;
  yFor: (value: number) => number;
  field: PointKey;
  color: string;
  width: number;
}) {
  return (
    <path
      d={linePath(candles, xFor, yFor, field)}
      fill="none"
      stroke={color}
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
}

function linePath(candles: Candle[], xFor: (index: number) => number, yFor: (value: number) => number, field: PointKey) {
  return candles
    .map((candle, index) => {
      const raw = candle[field];
      if (!isNumber(raw)) {
        return "";
      }
      return `${index === 0 ? "M" : "L"} ${xFor(index)} ${yFor(raw)}`;
    })
    .filter(Boolean)
    .join(" ");
}

function rsiPath(candles: Candle[], xFor: (index: number) => number, yFor: (value: number) => number) {
  return candles
    .map((candle, index) => {
      if (!isNumber(candle.rsi14)) {
        return "";
      }
      return `${index === 0 ? "M" : "L"} ${xFor(index)} ${yFor(candle.rsi14)}`;
    })
    .filter(Boolean)
    .join(" ");
}

function volumeSmaPath(candles: Candle[], xFor: (index: number) => number, yFor: (value: number) => number) {
  return candles
    .map((candle, index) => {
      if (!isNumber(candle.volumeSma20)) {
        return "";
      }
      return `${index === 0 ? "M" : "L"} ${xFor(index)} ${yFor(candle.volumeSma20)}`;
    })
    .filter(Boolean)
    .join(" ");
}

function scale(value: number, min: number, max: number, outMax: number, outMin: number) {
  if (max === min) {
    return (outMin + outMax) / 2;
  }
  const padding = (max - min) * 0.08;
  const paddedMin = min - padding;
  const paddedMax = max + padding;
  return outMax - ((value - paddedMin) / (paddedMax - paddedMin)) * (outMax - outMin);
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <span className="legend-item">
      <span style={{ background: color }} />
      {label}
    </span>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="chart-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatUsdValue(value: number | undefined) {
  return value === undefined || Number.isNaN(value) ? "-" : formatUsd(value);
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
