# BTC/USDT Binance Spot EMA Trading Bot

Python 3 crypto spot trading bot for Binance focused on BTC/USDT spot trading using EMA 9, EMA 21, EMA 200, RSI 14, and Volume SMA 20 on the 15 minute timeframe. The repo also includes a Vercel-ready Next.js dashboard for monitoring the BTC/USDT strategy signal.

## Important

This is production-oriented code, but it is not financial advice. Run in `dry_run: true` first, verify exchange permissions, and understand Binance lot size/min notional rules before trading real funds.

## Features

- Binance spot trading through `ccxt`
- BTC/USDT only, 15 minute timeframe
- EMA crossover strategy with RSI, trend, candle close, and volume filters
- 1% account risk position sizing
- Swing-low stop loss
- No fixed 1:2 take-profit chasing; exits follow the sell rules
- Optional EMA 21 trailing stop
- Duplicate-entry prevention with persistent state
- CSV trade logging
- Telegram notifications
- Backtesting CLI using CSV historical data
- Vercel-ready BTC strategy dashboard

## Installation

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
cp config.example.yaml config.yaml
```

Edit `.env` with Binance and optional Telegram credentials. Edit `config.yaml` before going live.

The example starting capital is `100000` USDT.

## Live Bot

Keep `dry_run: true` until you have verified behavior:

```bash
python -m src.main --config config.yaml
```

To trade live, set:

```yaml
trading:
  dry_run: false
```

Your Binance API key should have spot trading enabled and withdrawal disabled.

## Vercel Frontend

Install and run the dashboard locally:

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

Deploy to Vercel:

```bash
npm install -g vercel
vercel
vercel --prod
```

The Vercel frontend monitors public BTC/USDT market data. Keep the Python trading worker running separately on your computer or a VPS because Vercel serverless functions are not designed for persistent trading loops.

Optional Vercel environment variables:

```text
BINANCE_API_KEY=your_binance_api_key
BINANCE_API_SECRET=your_binance_api_secret
```

The dashboard does not expose these values to the browser. BTC/USDT live price data uses Binance public endpoints, so credentials are optional for the frontend.

## Backtesting

Place historical CSV files in `data/historical` using filenames like:

- `BTC_USDT_15m.csv`

Required columns:

```text
timestamp,open,high,low,close,volume
```

Then run:

```bash
python -m src.backtest --config config.yaml --symbol BTC/USDT
```

## Download Historical Data

You can export candles from Binance or use your own source. The backtester expects 15 minute OHLCV CSV data with timestamps parseable by pandas.

## Project Structure

```text
src/
  backtest.py          Backtest CLI
  config.py            YAML and env loading
  exchange.py          Binance spot wrapper
  indicators.py        Indicator calculation
  logger.py            CSV trade logger
  main.py              Live bot CLI
  models.py            Dataclasses and signal types
  notifications.py     Telegram client
  risk.py              Position sizing and stops
  state.py             Persistent open-position state
  strategy.py          Trading rules
app/
  page.tsx             BTC/USDT Vercel dashboard
  api/market/route.ts  Binance public market data endpoint
```

## Strategy Rules

Buy:

1. Close is above EMA 200.
2. EMA 9 crosses above EMA 21.
3. RSI 14 is greater than 55.
4. Candle closes above EMA 9 and EMA 21.
5. Volume is above Volume SMA 20.

Sell:

1. EMA 9 crosses below EMA 21.
2. RSI 14 falls below 45.
3. Stop loss is hit.
4. Optional EMA 21 trailing stop is hit.
