// app/components/ManageApis.tsx
"use client";

import React from "react";

export default function ManageApis({
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
  errorMsg,
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
    <div className="card api-config-card" style={{ padding: "1.5rem" }}>
      <h3>API Configuration</h3>
      <form onSubmit={onSave} style={{ display: "grid", gap: "0.75rem" }}>
        <label>
          Binance API Key (optional)
          <input
            type="text"
            placeholder="Enter API Key"
            value={formKey}
            onChange={(e) => setFormKey(e.target.value)}
          />
        </label>
        <label>
          Binance API Secret (optional)
          <input
            type="text"
            placeholder="Enter API Secret"
            value={formSecret}
            onChange={(e) => setFormSecret(e.target.value)}
          />
        </label>
        <label>
          Trading Pair Symbol
          <input
            type="text"
            placeholder="e.g., BTC/USDT"
            value={formSymbol}
            onChange={(e) => setFormSymbol(e.target.value)}
          />
        </label>
        <label>
          Timeframe Interval
          <input
            type="text"
            placeholder="e.g., 15m"
            value={formTimeframe}
            onChange={(e) => setFormTimeframe(e.target.value)}
          />
        </label>
        <label>
          Capital Allocation (absolute USDT amount)
          <input
            type="number"
            min={0}
            placeholder="Enter amount"
            value={formBalance}
            onChange={(e) => setFormBalance(e.target.value)}
          />
        </label>
        {errorMsg && <p className="error-text" style={{ color: "var(--red)" }}>{errorMsg}</p>}
        {successMsg && <p className="success-text" style={{ color: "var(--green)" }}>{successMsg}</p>}
        <button type="submit" disabled={isSaving} className="button" style={{ alignSelf: "start" }}>
          {isSaving ? "Saving…" : "Save Configuration"}
        </button>
      </form>
    </div>
  );
}
