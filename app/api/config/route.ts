import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

const configPath = path.join(process.cwd(), "config.yaml");
const envPath = path.join(process.cwd(), ".env");

export async function GET() {
  try {
    let symbol = "BTC/USDT";
    let timeframe = "15m";
    let allottedBalance = 100000;
    let hasApiKey = false;
    let hasApiSecret = false;

    // 1. Read config.yaml
    if (fs.existsSync(configPath)) {
      const configText = fs.readFileSync(configPath, "utf-8");

      // Extract symbol
      const symbolMatch = configText.match(/symbols:\s*\n\s*-\s*(\S+)/);
      if (symbolMatch) symbol = symbolMatch[1];

      // Extract timeframe
      const tfMatch = configText.match(/timeframe:\s*(\S+)/);
      if (tfMatch) timeframe = tfMatch[1];

      // Extract starting_balance
      const balMatch = configText.match(/starting_balance:\s*(\S+)/);
      if (balMatch) allottedBalance = Number(balMatch[1]) || 100000;
    }

    // 2. Read .env for keys presence
    if (fs.existsSync(envPath)) {
      const envText = fs.readFileSync(envPath, "utf-8");
      hasApiKey = /BINANCE_API_KEY=\s*\S+/.test(envText);
      hasApiSecret = /BINANCE_API_SECRET=\s*\S+/.test(envText);
    }

    return NextResponse.json({
      symbol,
      timeframe,
      allottedBalance,
      hasApiKey,
      hasApiSecret
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to read configuration: " + (error instanceof Error ? error.message : "unknown") },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { apiKey, apiSecret, symbol, timeframe, allottedBalance } = await request.json();

    if (!symbol || !timeframe || !allottedBalance) {
      return NextResponse.json({ error: "Missing required fields." }, { status: 400 });
    }

    // 1. Update config.yaml
    if (fs.existsSync(configPath)) {
      let configText = fs.readFileSync(configPath, "utf-8");

      // Replace symbols list
      configText = configText.replace(/symbols:\s*\n\s*-\s*\S+/, `symbols:\n    - ${symbol}`);

      // Replace timeframe
      configText = configText.replace(/timeframe:\s*\S+/, `timeframe: ${timeframe}`);

      // Replace starting_balance
      configText = configText.replace(/starting_balance:\s*\S+/, `starting_balance: ${allottedBalance}`);

      fs.writeFileSync(configPath, configText, "utf-8");
    }

    // 2. Update .env (preserving other variables)
    let envVars: Record<string, string> = {};
    if (fs.existsSync(envPath)) {
      const envText = fs.readFileSync(envPath, "utf-8");
      envText.split("\n").forEach((line) => {
        const parts = line.split("=");
        if (parts.length >= 2) {
          const key = parts[0].trim();
          const val = parts.slice(1).join("=").trim();
          if (key) envVars[key] = val;
        }
      });
    }

    // Merge incoming keys if provided
    if (apiKey) envVars["BINANCE_API_KEY"] = apiKey;
    if (apiSecret) envVars["BINANCE_API_SECRET"] = apiSecret;

    // Convert back to env string format
    const envTextToWrite = Object.entries(envVars)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n") + "\n";

    fs.writeFileSync(envPath, envTextToWrite, "utf-8");

    return NextResponse.json({
      success: true,
      config: { symbol, timeframe, allottedBalance }
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to update configuration: " + (error instanceof Error ? error.message : "unknown") },
      { status: 500 }
    );
  }
}
