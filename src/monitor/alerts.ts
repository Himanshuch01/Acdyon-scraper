/**
 * Minimal alerting: fires a webhook (Slack/Discord/any URL) if ALERT_WEBHOOK is set,
 * otherwise logs at error level. Small, but it proves observability was designed in.
 */
import { logger } from "./logger";

export type AlertEvent =
  | "circuit_open"
  | "parse_drift"
  | "suspected_silent_block"
  | "validation_spike"
  | "run_failed";

export async function alert(event: AlertEvent, details: Record<string, unknown>) {
  const url = process.env.ALERT_WEBHOOK;
  const payload = { event, at: new Date().toISOString(), ...details };
  if (!url) {
    logger.error({ alert: payload }, `ALERT: ${event} (no ALERT_WEBHOOK set, logging only)`);
    return;
  }
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: `🚨 scraper alert: ${event}\n\`\`\`${JSON.stringify(payload, null, 2)}\`\`\`` }),
    });
  } catch (err) {
    logger.error({ err, alert: payload }, "failed to deliver alert webhook");
  }
}
