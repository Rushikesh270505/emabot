"use client";

import { BarChart3, ZoomIn, ZoomOut, MoveLeft, MoveRight, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatNumber, formatUsd, type Candle } from "@/lib/market";

type PointKey = "close" | "ema9" | "ema21" | "ema200";

// Layout constants for SVG coordinate mapping
const SVG_WIDTH = 1000;
const PRICE_HEIGHT = 280;
const VOLUME_HEIGHT = 80;
const RSI_HEIGHT = 80;
const GAP = 22;
const TOTAL_HEIGHT = PRICE_HEIGHT + VOLUME_HEIGHT + RSI_HEIGHT + GAP * 2;

const PAD_X = 20;
const PAD_RIGHT = 80; // Space for price scale labels on the right
const PAD_TOP = 15;
const PAD_BOTTOM = 15;

export function StrategyChart({
  candles,
  isLoadingOlder,
  onLoadOlder
}: {
  candles: Candle[];
  isLoadingOlder: boolean;
  onLoadOlder: () => void;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);

  // Filter candles that have at least some basic indicator calculations
  const series = candles;

  // Zoom and Pan states
  const [zoom, setZoom] = useState(70); // number of candles visible in the window
  const [panOffset, setPanOffset] = useState(0); // offset from the end (0 means latest candles visible)

  // Interactive mouse tracking states
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [mouseX, setMouseX] = useState<number | null>(null);
  const [mouseY, setMouseY] = useState<number | null>(null);

  // Refs for drag to pan behavior
  const isDragging = useRef(false);
  const dragStartX = useRef<number | null>(null);
  const dragStartPanOffset = useRef(0);

  // Auto-load older candles when user pans close to the left boundary of loaded data
  useEffect(() => {
    if (panOffset + zoom >= series.length - 10 && !isLoadingOlder) {
      onLoadOlder();
    }
  }, [panOffset, zoom, series.length, isLoadingOlder, onLoadOlder]);

  // Handle wheel scrolling (attaching non-passively to allow preventing default)
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      
      if (e.ctrlKey) {
        // Zooming: Ctrl + Wheel, or Pinch-to-zoom
        const zoomDelta = e.deltaY < 0 ? -3 : 3;
        setZoom((prevZoom) => Math.max(15, Math.min(180, prevZoom + zoomDelta)));
      } else {
        // Panning: standard scrolling (vertical wheel or horizontal trackpad)
        const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        const panDelta = delta < 0 ? -3 : 3; // scroll speed (3 candles per tick)
        
        setPanOffset((prevOffset) => {
          const nextOffset = prevOffset + panDelta;
          return Math.max(0, Math.min(series.length - zoom, nextOffset));
        });
      }
    };

    svg.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      svg.removeEventListener("wheel", handleWheel);
    };
  }, [series.length, zoom]);

  if (series.length === 0) {
    return (
      <section className="chart-panel">
        <div className="chart-head">
          <h3>BTC/USDT Strategy Chart</h3>
        </div>
        <div style={{ height: TOTAL_HEIGHT, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)" }}>
          No candle history available
        </div>
      </section>
    );
  }

  // Slice series to extract the visible window of candles
  const endIdx = series.length - panOffset;
  const startIdx = Math.max(0, endIdx - zoom);
  const visibleSeries = series.slice(startIdx, endIdx);

  // Generate strategy signals for all candles to render BUY/SELL markers
  const signals = detectCandleSignals(series);

  // Find min/max values in the visible window for scaling
  const priceValues = visibleSeries.flatMap((c) => [
    c.high,
    c.low,
    c.close,
    c.ema9,
    c.ema21,
    c.ema200
  ]).filter(isNumber);

  const minPrice = Math.min(...priceValues);
  const maxPrice = Math.max(...priceValues);
  const maxVolume = Math.max(...visibleSeries.map((c) => c.volume)) || 1;

  // X coordinate mapping functions
  const xFor = (index: number) => {
    if (visibleSeries.length <= 1) return PAD_X;
    const chartWidth = SVG_WIDTH - PAD_X - PAD_RIGHT;
    return PAD_X + (index * chartWidth) / (visibleSeries.length - 1);
  };

  const candleWidth = Math.max(2, Math.floor(((SVG_WIDTH - PAD_X - PAD_RIGHT) / visibleSeries.length) * 0.65));

  // Y coordinate mapping functions for panels
  const priceY = (value: number) => scale(value, minPrice, maxPrice, PRICE_HEIGHT - PAD_BOTTOM, PAD_TOP);
  const volumeBase = PRICE_HEIGHT + GAP + VOLUME_HEIGHT - PAD_BOTTOM;
  const volumeY = (value: number) =>
    PRICE_HEIGHT + GAP + scale(value, 0, maxVolume, VOLUME_HEIGHT - PAD_BOTTOM, PAD_TOP);

  const rsiBase = PRICE_HEIGHT + GAP + VOLUME_HEIGHT + GAP + RSI_HEIGHT - PAD_BOTTOM;
  const rsiY = (value: number) =>
    PRICE_HEIGHT + GAP + VOLUME_HEIGHT + GAP + scale(value, 0, 100, RSI_HEIGHT - PAD_BOTTOM, PAD_TOP);

  // Mouse event handlers
  const handleMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    if (e.button !== 0) return; // Left click only
    isDragging.current = true;
    dragStartX.current = e.clientX;
    dragStartPanOffset.current = panOffset;
  };

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;

    const rect = svg.getBoundingClientRect();
    const scaleX = SVG_WIDTH / rect.width;
    const scaleY = TOTAL_HEIGHT / rect.height;

    const mouseXVal = (e.clientX - rect.left) * scaleX;
    const mouseYVal = (e.clientY - rect.top) * scaleY;

    // Calculate hover index based on mouse X coordinate
    const chartWidth = SVG_WIDTH - PAD_X - PAD_RIGHT;
    const pct = (mouseXVal - PAD_X) / chartWidth;
    let idx = Math.round(pct * (visibleSeries.length - 1));
    idx = Math.max(0, Math.min(idx, visibleSeries.length - 1));

    setMouseX(mouseXVal);
    setMouseY(mouseYVal);
    setHoverIndex(idx);

    if (isDragging.current && dragStartX.current !== null) {
      const deltaX = e.clientX - dragStartX.current;
      // Map pixel delta to candle delta
      const candlesDelta = Math.round(deltaX / (rect.width / zoom));
      const newOffset = Math.max(0, Math.min(series.length - zoom, dragStartPanOffset.current - candlesDelta));
      setPanOffset(newOffset);
    }
  };

  const handleMouseUpOrLeave = () => {
    isDragging.current = false;
    dragStartX.current = null;
    if (!isDragging.current) {
      setHoverIndex(null);
      setMouseX(null);
      setMouseY(null);
    }
  };

  // Active HUD candle: hovered candle, otherwise falls back to the latest visible candle
  const activeCandle = hoverIndex !== null && visibleSeries[hoverIndex]
    ? visibleSeries[hoverIndex]
    : visibleSeries[visibleSeries.length - 1];

  const activeIndexInSeries = hoverIndex !== null 
    ? startIdx + hoverIndex 
    : series.length - 1 - panOffset;

  const activeSignal = signals[activeIndexInSeries];

  // Manual zoom/pan handlers
  const handleZoomIn = () => setZoom((z) => Math.max(15, z - 10));
  const handleZoomOut = () => setZoom((z) => Math.min(180, z + 10));
  const handlePanLeft = () => setPanOffset((p) => Math.min(series.length - zoom, p + 8));
  const handlePanRight = () => setPanOffset((p) => Math.max(0, p - 8));
  const handleReset = () => {
    setZoom(70);
    setPanOffset(0);
  };

  return (
    <section className="chart-panel interactive-chart">
      {/* Chart Header Toolbar */}
      <div className="chart-head">
        <div>
          <h3>BTC/USDT TradingView Chart</h3>
          <p>Drag to Pan | Scroll Wheel to Zoom | Hover for Interactive HUD & Crosshair</p>
        </div>
        <div className="chart-controls">
          <button className="icon-button" onClick={handlePanLeft} title="Pan Left"><MoveLeft size={16} /></button>
          <button className="icon-button" onClick={handleZoomOut} title="Zoom Out"><ZoomOut size={16} /></button>
          <button className="icon-button" onClick={handleReset} title="Reset Chart"><RotateCcw size={15} /></button>
          <button className="icon-button" onClick={handleZoomIn} title="Zoom In"><ZoomIn size={16} /></button>
          <button className="icon-button" onClick={handlePanRight} title="Pan Right"><MoveRight size={16} /></button>
          <span className="pill chart-pill">
            <BarChart3 size={14} />
            {isLoadingOlder ? "Loading history" : `${series.length} candles`}
          </span>
        </div>
      </div>

      {/* TradingView-style HUD Overlay */}
      <div className="hud-overlay">
        <div className="hud-time">
          {activeCandle ? formatDate(activeCandle.timestamp) : ""}
        </div>
        <div className="hud-candle">
          <span>O: <strong className={activeCandle && activeCandle.close >= activeCandle.open ? "up" : "down"}>{formatUsd(activeCandle?.open ?? 0)}</strong></span>
          <span>H: <strong className="high-val">{formatUsd(activeCandle?.high ?? 0)}</strong></span>
          <span>L: <strong className="low-val">{formatUsd(activeCandle?.low ?? 0)}</strong></span>
          <span>C: <strong className={activeCandle && activeCandle.close >= activeCandle.open ? "up" : "down"}>{formatUsd(activeCandle?.close ?? 0)}</strong></span>
          <span>V: <strong className="volume-val">{formatNumber(activeCandle?.volume, 2)}</strong></span>
        </div>
        <div className="hud-indicators">
          <span className="indicator-ema9">EMA9: <strong>{formatUsd(activeCandle?.ema9 ?? 0)}</strong></span>
          <span className="indicator-ema21">EMA21: <strong>{formatUsd(activeCandle?.ema21 ?? 0)}</strong></span>
          <span className="indicator-ema200">EMA200: <strong>{formatUsd(activeCandle?.ema200 ?? 0)}</strong></span>
          <span className="indicator-rsi14">RSI14: <strong>{formatNumber(activeCandle?.rsi14, 1)}</strong></span>
        </div>
        {activeSignal && activeSignal !== "HOLD" && (
          <div className={`hud-signal ${activeSignal.toLowerCase()}`}>
            Strategy Trigger: <strong>{activeSignal}</strong>
          </div>
        )}
      </div>

      {/* SVG Canvas */}
      <div className="chart-canvas-container">
        <svg
          className="chart"
          style={{ width: "100%", userSelect: "none" }}
          viewBox={`0 0 ${SVG_WIDTH} ${TOTAL_HEIGHT}`}
          role="img"
          aria-label="BTC interactive strategy chart"
          ref={svgRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUpOrLeave}
          onMouseLeave={handleMouseUpOrLeave}
        >
          <defs>
            <linearGradient id="priceFillUp" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#3ddc97" stopOpacity="0.16" />
              <stop offset="100%" stopColor="#3ddc97" stopOpacity="0" />
            </linearGradient>
            <clipPath id="priceClip">
              <rect x="0" y="0" width={SVG_WIDTH - PAD_RIGHT} height={PRICE_HEIGHT} />
            </clipPath>
          </defs>

          {/* Grid Background Panels */}
          <PanelGrid y={0} height={PRICE_HEIGHT} width={SVG_WIDTH} />
          <PanelGrid y={PRICE_HEIGHT + GAP} height={VOLUME_HEIGHT} width={SVG_WIDTH} />
          <PanelGrid y={PRICE_HEIGHT + GAP + VOLUME_HEIGHT + GAP} height={RSI_HEIGHT} width={SVG_WIDTH} />

          {/* Static Reference and Guide Lines */}
          <RsiGuide yFor={rsiY} width={SVG_WIDTH} />
          <PriceLabels min={minPrice} max={maxPrice} yFor={priceY} width={SVG_WIDTH} />

          <line x1={PAD_X} x2={SVG_WIDTH - PAD_RIGHT} y1={rsiY(70)} y2={rsiY(70)} stroke="#ff5c7a" strokeDasharray="3 5" opacity="0.45" />
          <line x1={PAD_X} x2={SVG_WIDTH - PAD_RIGHT} y1={rsiY(55)} y2={rsiY(55)} stroke="#3ddc97" strokeDasharray="3 5" opacity="0.3" />
          <line x1={PAD_X} x2={SVG_WIDTH - PAD_RIGHT} y1={rsiY(45)} y2={rsiY(45)} stroke="#f6c453" strokeDasharray="3 5" opacity="0.3" />
          <line x1={PAD_X} x2={SVG_WIDTH - PAD_RIGHT} y1={rsiY(30)} y2={rsiY(30)} stroke="#6aa8ff" strokeDasharray="3 5" opacity="0.4" />

          {/* Area gradient under close price */}
          <path
            d={`${linePath(visibleSeries, xFor, priceY, "close")} L ${xFor(visibleSeries.length - 1)} ${PRICE_HEIGHT - PAD_BOTTOM} L ${xFor(0)} ${PRICE_HEIGHT - PAD_BOTTOM} Z`}
            fill="url(#priceFillUp)"
            clipPath="url(#priceClip)"
          />

          {/* Candlesticks (Wicks and Bodies) */}
          {visibleSeries.map((candle, index) => {
            const x = xFor(index);
            const up = candle.close >= candle.open;
            const bodyTop = priceY(Math.max(candle.open, candle.close));
            const bodyBottom = priceY(Math.min(candle.open, candle.close));
            const color = up ? "#3ddc97" : "#ff5c7a";
            return (
              <g key={`candle-${candle.timestamp}`}>
                <line x1={x} x2={x} y1={priceY(candle.high)} y2={priceY(candle.low)} stroke={color} strokeWidth="1.2" />
                <rect
                  x={x - candleWidth / 2}
                  y={bodyTop}
                  width={candleWidth}
                  height={Math.max(1.5, bodyBottom - bodyTop)}
                  fill={color}
                  opacity="0.92"
                />
              </g>
            );
          })}

          {/* Indicator Line Series */}
          <SeriesPath candles={visibleSeries} xFor={xFor} yFor={priceY} field="close" color="rgba(238,243,247,0.4)" width={1.2} />
          <SeriesPath candles={visibleSeries} xFor={xFor} yFor={priceY} field="ema9" color="#3ddc97" width={1.8} />
          <SeriesPath candles={visibleSeries} xFor={xFor} yFor={priceY} field="ema21" color="#ff5c7a" width={1.8} />
          <SeriesPath candles={visibleSeries} xFor={xFor} yFor={priceY} field="ema200" color="#f6c453" width={1.8} />

          {/* RSI Indicator Line */}
          <path d={rsiPath(visibleSeries, xFor, rsiY)} fill="none" stroke="#b58cff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />

          {/* Volume bars */}
          {visibleSeries.map((candle, index) => {
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
                fill={color}
                opacity="0.38"
              />
            );
          })}
          <path d={volumeSmaPath(visibleSeries, xFor, volumeY)} fill="none" stroke="#8bd3dd" strokeWidth="1.5" strokeLinecap="round" />

          {/* BUY and SELL Strategy execution markers */}
          {visibleSeries.map((candle, index) => {
            const seriesIndex = startIdx + index;
            const signal = signals[seriesIndex];
            const x = xFor(index);

            if (signal === "BUY") {
              const y = priceY(candle.low) + 14;
              return (
                <g key={`sig-buy-${candle.timestamp}`}>
                  <polygon points={`${x},${y} ${x - 5},${y + 8} ${x + 5},${y + 8}`} fill="#3ddc97" />
                  <text x={x} y={y + 18} fill="#3ddc97" fontSize="9" fontWeight="800" textAnchor="middle">BUY</text>
                </g>
              );
            } else if (signal === "SELL") {
              const y = priceY(candle.high) - 14;
              return (
                <g key={`sig-sell-${candle.timestamp}`}>
                  <polygon points={`${x},${y} ${x - 5},${y - 8} ${x + 5},${y - 8}`} fill="#ff5c7a" />
                  <text x={x} y={y - 14} fill="#ff5c7a" fontSize="9" fontWeight="800" textAnchor="middle">SELL</text>
                </g>
              );
            }
            return null;
          })}

          {/* Label Panels */}
          <text x={PAD_X} y={PRICE_HEIGHT - 10} fill="#94a3b8" fontSize="10" opacity="0.6">PRICE</text>
          <text x={PAD_X} y={PRICE_HEIGHT + GAP + VOLUME_HEIGHT - 10} fill="#94a3b8" fontSize="10" opacity="0.6">VOLUME</text>
          <text x={PAD_X} y={PRICE_HEIGHT + GAP + VOLUME_HEIGHT + GAP + RSI_HEIGHT - 10} fill="#94a3b8" fontSize="10" opacity="0.6">RSI 14</text>

          {/* Interactive Crosshair & Tooltips Overlay */}
          {hoverIndex !== null && mouseX !== null && mouseY !== null && (
            <g>
              {/* Vertical Crosshair Line */}
              <line
                x1={xFor(hoverIndex)}
                x2={xFor(hoverIndex)}
                y1={0}
                y2={TOTAL_HEIGHT}
                stroke="#94a3b8"
                strokeDasharray="2 3"
                opacity="0.5"
                pointerEvents="none"
              />

              {/* Horizontal Crosshair Line */}
              <line
                x1={PAD_X}
                x2={SVG_WIDTH - PAD_RIGHT}
                y1={mouseY}
                y2={mouseY}
                stroke="#94a3b8"
                strokeDasharray="2 3"
                opacity="0.5"
                pointerEvents="none"
              />

              {/* Timestamp label on X-axis */}
              <g transform={`translate(${xFor(hoverIndex)}, ${TOTAL_HEIGHT})`}>
                <rect
                  x="-65"
                  y="-18"
                  width="130"
                  height="18"
                  rx="3"
                  fill="#1c2530"
                  stroke="#26313d"
                  strokeWidth="1"
                />
                <text
                  x="0"
                  y="-5"
                  fill="#eef3f7"
                  fontSize="9.5"
                  fontWeight="600"
                  textAnchor="middle"
                >
                  {formatCrosshairTime(activeCandle.timestamp)}
                </text>
              </g>

              {/* Price level label on Y-axis (Price Panel) */}
              {mouseY <= PRICE_HEIGHT && (
                <g transform={`translate(${SVG_WIDTH - PAD_RIGHT}, ${mouseY})`}>
                  <rect
                    x="2"
                    y="-9"
                    width="74"
                    height="18"
                    rx="3"
                    fill="#1c2530"
                    stroke="#26313d"
                    strokeWidth="1"
                  />
                  <text
                    x="39"
                    y="3"
                    fill="#3ddc97"
                    fontSize="9.5"
                    fontWeight="700"
                    textAnchor="middle"
                  >
                    {formatUsd(unscale(mouseY, minPrice, maxPrice, PRICE_HEIGHT - PAD_BOTTOM, PAD_TOP))}
                  </text>
                </g>
              )}

              {/* RSI level label on Y-axis (RSI Panel) */}
              {mouseY >= PRICE_HEIGHT + GAP + VOLUME_HEIGHT + GAP && mouseY <= TOTAL_HEIGHT && (
                <g transform={`translate(${SVG_WIDTH - PAD_RIGHT}, ${mouseY})`}>
                  <rect
                    x="2"
                    y="-9"
                    width="35"
                    height="18"
                    rx="3"
                    fill="#1c2530"
                    stroke="#26313d"
                    strokeWidth="1"
                  />
                  <text
                    x="19.5"
                    y="3"
                    fill="#b58cff"
                    fontSize="9.5"
                    fontWeight="700"
                    textAnchor="middle"
                  >
                    {Math.round(unscale(mouseY, 0, 100, rsiBase, PRICE_HEIGHT + GAP + VOLUME_HEIGHT + GAP + PAD_TOP))}
                  </text>
                </g>
              )}
            </g>
          )}
        </svg>
      </div>

      {/* Bottom stats indicators */}
      <div className="chart-stats">
        <Metric label="Selected Close" value={formatUsd(activeCandle?.close ?? 0)} />
        <Metric label="EMA 9 / 21" value={`${formatUsdValue(activeCandle?.ema9)} / ${formatUsdValue(activeCandle?.ema21)}`} />
        <Metric label="RSI 14" value={formatNumber(activeCandle?.rsi14, 1)} />
        <Metric label="Volume SMA 20" value={formatNumber(activeCandle?.volumeSma20, 2)} />
      </div>
    </section>
  );
}

// Grid Panel Component
function PanelGrid({ y, height, width }: { y: number; height: number; width: number }) {
  return (
    <g>
      <rect x="2" y={y} width={width - 4} height={height} rx="6" fill="rgba(255,255,255,0.012)" stroke="rgba(148,163,184,0.08)" />
      {[0.25, 0.5, 0.75].map((tick) => (
        <line
          key={tick}
          x1={PAD_X}
          x2={width - PAD_RIGHT}
          y1={y + height * tick}
          y2={y + height * tick}
          stroke="rgba(148,163,184,0.06)"
          strokeWidth="0.8"
        />
      ))}
    </g>
  );
}

// Right Y Axis Labels for Price
function PriceLabels({ min, max, yFor, width }: { min: number; max: number; yFor: (value: number) => number; width: number }) {
  return (
    <g>
      {[min, (min + max) / 2, max].map((value) => (
        <text key={value} x={width - PAD_RIGHT + 8} y={yFor(value) + 3} fill="#94a3b8" fontSize="10" fontWeight="500">
          {formatUsd(value)}
        </text>
      ))}
    </g>
  );
}

// Right Y Axis Labels for RSI
function RsiGuide({ yFor, width }: { yFor: (value: number) => number; width: number }) {
  return (
    <g>
      {[70, 55, 45, 30].map((value) => (
        <text key={value} x={width - PAD_RIGHT + 8} y={yFor(value) + 3} fill="#94a3b8" fontSize="10" fontWeight="500">
          {value}
        </text>
      ))}
    </g>
  );
}

// Renders an indicator line series
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

// Generate SVG string for indicator line paths
function linePath(candles: Candle[], xFor: (index: number) => number, yFor: (value: number) => number, field: PointKey) {
  return candles
    .map((candle, index) => {
      const raw = candle[field];
      if (!isNumber(raw)) return "";
      return `${index === 0 ? "M" : "L"} ${xFor(index)} ${yFor(raw)}`;
    })
    .filter(Boolean)
    .join(" ");
}

function rsiPath(candles: Candle[], xFor: (index: number) => number, yFor: (value: number) => number) {
  return candles
    .map((candle, index) => {
      if (!isNumber(candle.rsi14)) return "";
      return `${index === 0 ? "M" : "L"} ${xFor(index)} ${yFor(candle.rsi14)}`;
    })
    .filter(Boolean)
    .join(" ");
}

function volumeSmaPath(candles: Candle[], xFor: (index: number) => number, yFor: (value: number) => number) {
  return candles
    .map((candle, index) => {
      if (!isNumber(candle.volumeSma20)) return "";
      return `${index === 0 ? "M" : "L"} ${xFor(index)} ${yFor(candle.volumeSma20)}`;
    })
    .filter(Boolean)
    .join(" ");
}

// Core Math scaling functions
function scale(value: number, min: number, max: number, outMax: number, outMin: number) {
  if (max === min) return (outMin + outMax) / 2;
  const padding = (max - min) * 0.05;
  const paddedMin = min - padding;
  const paddedMax = max + padding;
  return outMax - ((value - paddedMin) / (paddedMax - paddedMin)) * (outMax - outMin);
}

function unscale(y: number, min: number, max: number, outMax: number, outMin: number) {
  if (outMax === outMin) return min;
  const padding = (max - min) * 0.05;
  const paddedMin = min - padding;
  const paddedMax = max + padding;
  const pct = (outMax - y) / (outMax - outMin);
  return paddedMin + pct * (paddedMax - paddedMin);
}

// Metric block UI
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

function value(val: number | undefined): number {
  return val ?? Number.NaN;
}

// Time formatting helpers
function formatDate(isoString: string): string {
  try {
    const d = new Date(isoString);
    return d.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    });
  } catch {
    return isoString;
  }
}

function formatCrosshairTime(isoString: string): string {
  try {
    const d = new Date(isoString);
    return d.toLocaleString("en-US", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    });
  } catch {
    return isoString;
  }
}

// Simple trade signals detector based on crossover
function detectCandleSignals(candles: Candle[]): Array<"BUY" | "SELL" | "HOLD"> {
  const signals: Array<"BUY" | "SELL" | "HOLD"> = Array(candles.length).fill("HOLD");
  let inPosition = false;

  for (let i = 201; i < candles.length; i++) {
    const latest = candles[i];
    const previous = candles[i - 1];

    const crossedUp = value(previous.ema9) <= value(previous.ema21) && value(latest.ema9) > value(latest.ema21);
    const crossedDown = value(previous.ema9) >= value(previous.ema21) && value(latest.ema9) < value(latest.ema21);

    if (!inPosition && crossedUp) {
      signals[i] = "BUY";
      inPosition = true;
    } else if (inPosition && crossedDown) {
      signals[i] = "SELL";
      inPosition = false;
    }
  }
  return signals;
}
