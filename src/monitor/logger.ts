/**
 * Structured logging. Every line carries runId + sessionId so you can trace a
 * full failure→recovery cycle and put a single log line on screen during the call.
 */
import pino from "pino";
import { randomUUID } from "crypto";

export const runId = randomUUID().slice(0, 8);

export const logger = pino(
  { level: process.env.LOG_LEVEL ?? "info" },
  pino.destination({ sync: true })
);

export function childLogger(bindings: Record<string, unknown>) {
  return logger.child({ runId, ...bindings });
}
