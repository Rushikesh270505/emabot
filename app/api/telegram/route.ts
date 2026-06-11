// app/api/telegram/route.ts
import { NextResponse } from 'next/server';
import { sendTelegramMessage } from '@/app/lib/telegram';

/**
 * Simple webhook endpoint for Telegram bot updates.
 * Telegram will POST the update JSON to this URL (you must set the webhook via
 * `https://api.telegram.org/bot<token>/setWebhook?url=<your-domain>/api/telegram`).
 *
 * Supported commands:
 *   /balance – returns the current cash + BTC balance.
 *   /buy     – acknowledges a manual BUY request.
 *   /sell    – acknowledges a manual SELL request.
 *   /start   – short welcome message.
 *   /help    – list of available commands.
 */
export async function POST(request: Request) {
  try {
    const update = await request.json();
    const message = update?.message?.text?.trim();
    if (!message) return NextResponse.json({ ok: false, error: 'No message' }, { status: 400 });

    // Normalise command (remove leading / if present)
    const command = message.startsWith('/') ? message.slice(1).toLowerCase() : message.toLowerCase();
    let reply = '';

    switch (command) {
      case 'balance':
        // Fetch current market snapshot to compute balance
        try {
          const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || ''}/api/market`);
          if (res.ok) {
            const market = await res.json();
            const price = market.price;
            const btcValue = market.portfolio.btcAmount * price;
            const total = market.portfolio.cash + btcValue;
            reply = `💰 Current balance: $${total.toFixed(2)} (Cash: $${market.portfolio.cash.toFixed(2)}, BTC: ${market.portfolio.btcAmount.toFixed(6)} ≈ $${btcValue.toFixed(2)})`;
          } else {
            reply = '⚠️ Could not fetch market data.';
          }
        } catch (_) {
          reply = '⚠️ Error retrieving market information.';
        }
        break;
      case 'buy': {
        // Execute a manual BUY using current market data
        try {
          const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || ''}/api/market`);
          if (!res.ok) throw new Error('market fetch failed');
          const market = await res.json();
          const price = market.price;
          if (market.portfolio.cash <= 0) {
            reply = '⚠️ No cash available to BUY.';
            break;
          }
          const btcAmount = market.portfolio.cash / price;
          const positionCost = market.portfolio.cash;
          const newTrade = {
            timestamp: new Date().toISOString(),
            side: 'BUY',
            price,
            amount: btcAmount,
            value: positionCost,
          };
          // You could persist this trade to a DB or in-memory store here.
          const cash = 0;
          const btc = btcAmount;
          const updatedBalance = btc * price;
          reply = `🟢 BUY executed at $${price.toFixed(2)} for ${btcAmount.toFixed(6)} BTC.\nNew balance: $${cash.toFixed(2)} cash, ${btc.toFixed(6)} BTC (≈ $${updatedBalance.toFixed(2)})`;
        } catch (e) {
          reply = '⚠️ Failed to execute BUY command.';
        }
        break;
      }
      case 'sell': {
        // Execute a manual SELL using current market data
        try {
          const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || ''}/api/market`);
          if (!res.ok) throw new Error('market fetch failed');
          const market = await res.json();
          if (!market.portfolio.inPosition || market.portfolio.btcAmount <= 0) {
            reply = '⚠️ No BTC position to SELL.';
            break;
          }
          const price = market.price;
          const cashValue = market.portfolio.btcAmount * price;
          const profitLoss = cashValue - market.portfolio.positionCost;
          const profitLossPct = market.portfolio.positionCost > 0 ? (profitLoss / market.portfolio.positionCost) * 100 : 0;
          const newTrade = {
            timestamp: new Date().toISOString(),
            side: 'SELL',
            price,
            amount: market.portfolio.btcAmount,
            value: cashValue,
            profitLoss,
            profitLossPct,
          };
          // Persist trade if needed.
          const cash = cashValue;
          reply = `🔴 SELL executed at $${price.toFixed(2)} for ${market.portfolio.btcAmount.toFixed(6)} BTC.\nP/L: $${profitLoss.toFixed(2)} (${profitLossPct.toFixed(2)}%).\nNew balance: $${cash.toFixed(2)} cash, 0 BTC.`;
        } catch (e) {
          reply = '⚠️ Failed to execute SELL command.';
        }
        break;
      }
      case 'start':
        reply = '👋 Welcome! Use /balance, /buy, /sell, /help to interact with EMABOT.';
        break;
      case 'help':
        reply = `Available commands:
/balance – Show current cash + BTC balance
/buy     – Execute a manual BUY (via UI)
/sell    – Execute a manual SELL (via UI)
/start   – Show a short welcome message
/help    – Show this help message`;
        break;
      default:
        reply = "❓ Unrecognized command. Send /help for the list of commands.";
    }

    // Send reply back to the user
    await sendTelegramMessage(reply);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Telegram webhook error', err);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}
