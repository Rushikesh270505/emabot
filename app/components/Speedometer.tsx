'use client';
import React, { useMemo } from 'react';

export interface SpeedometerProps {
  ema9?: number;
  ema21?: number;
}

/**
 * Cyber‑punk styled semi‑circular gauge.
 * Shows EMA‑9 vs EMA‑21 proximity as a percentage.
 * Needle rotates from –90° (‑100 %) to +90° (+100 %).
 * When bullish the gauge is fully neon‑green; when bearish fully neon‑pink.
 */
export default function Speedometer({ ema9, ema21 }: SpeedometerProps) {
  // Calculate percentage
  const pct = useMemo(() => {
    if (ema9 === undefined || ema21 === undefined || ema21 === 0) return 0;
    return ((ema9 - ema21) / ema21) * 100;
  }, [ema9, ema21]);

  // Clamp & normalise
  const clamped = Math.max(-100, Math.min(100, pct));
  const normalized = ((clamped + 100) / 200) * 100; // 0‑100 range

  const radius = 45;
  const circumference = Math.PI * radius; // half‑circle length
  const offset = circumference * (1 - normalized / 100);

  // Colour based on direction
  const color = clamped >= 0 ? '#00ff41' : '#ff0266'; // neon‑green / neon‑pink

  // Needle angle
  const angle = (clamped / 100) * 90; // -90° → +90°

  // Styles
  const containerStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    width: '180px',
    height: '110px',
    padding: '0.5rem',
    background: 'radial-gradient(circle at 50% 50%, #111 40%, #000 100%)',
    borderRadius: '12px',
    boxShadow: '0 0 20px rgba(0,0,0,0.8)',
    backdropFilter: 'blur(4px)',
    border: '1px solid rgba(255,255,255,0.1)',
  };

  const textStyle: React.CSSProperties = {
    fill: color,
    fontSize: '0.95rem',
    fontWeight: 800,
    fontFamily: "'Orbitron', sans-serif",
    filter: `drop-shadow(0 0 4px ${color})`,
  };

  const needleGroupStyle: React.CSSProperties = {
    transition: 'transform 0.6s ease-out',
    transformOrigin: '50px 50px',
  };

  const needleStyle: React.CSSProperties = {
    stroke: color,
    strokeWidth: 2,
    filter: `drop-shadow(0 0 6px ${color})`,
  };

  const arcStyle: React.CSSProperties = {
    transition: 'stroke-dashoffset 0.6s ease-out, stroke 0.6s',
    filter: `drop-shadow(0 0 8px ${color})`,
  };

  const trackColor = '#1a1a1a';

  return (
    <div style={containerStyle}>
      <svg width="180" height="120" viewBox="0 0 100 60" preserveAspectRatio="xMidYMid meet">
        {/* Dark background track */}
        <path d="M5,55 A45,45 0 0,1 95,55" stroke={trackColor} strokeWidth="8" fill="none" />
        {/* Animated foreground arc */}
        <path
          d="M5,55 A45,45 0 0,1 95,55"
          stroke={color}
          strokeWidth="8"
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={arcStyle}
        />
        {/* Neon needle */}
        <g transform={`rotate(${angle} 50 50)`} style={needleGroupStyle}>
          <line x1="50" y1="50" x2="50" y2="12" style={needleStyle} />
        </g>
        {/* Percentage label */}
        <text x="50%" y="65%" dominantBaseline="middle" textAnchor="middle" style={textStyle}>
          {clamped.toFixed(1)}%
        </text>
      </svg>
    </div>
  );
}
