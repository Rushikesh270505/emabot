/**
 * Simple Telegram helper for sending messages.
 * Uses the bot token and chat ID directly (hard‑coded for this demo).
 * In a real project you would store the token in an environment variable
 * and possibly expose a server‑side API endpoint.
 */

const TELEGRAM_BOT_TOKEN = "8758585389:AAHJsRn1yILVWLJVU-4A5NEBhqE7dYftoIY";
const CHAT_ID = 6329058632; // extracted from getUpdates response

/**
 * Sends a plain‑text message to the configured chat.
 * @param message The message body to send.
 */
export async function sendTelegramMessage(message: string): Promise<void> {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const payload = {
    chat_id: CHAT_ID,
    text: message,
    parse_mode: "Markdown",
  };
  try {
    await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error("Failed to send Telegram message", err);
  }
}
