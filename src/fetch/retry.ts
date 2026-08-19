/**
 * Retry policy: exponential backoff with FULL jitter, capped, and honoring
 * Retry-After. Only retryable errors are retried — retrying a hard block
 * (403/CAPTCHA) just digs the hole deeper.
 *
 * This is the classic AI-draft fix: LLMs default to `setInterval`-style fixed
 * retries; fixed timing is exactly the pattern behavioral detection looks for.
 */
import { config } from "../config";
import { childLogger } from "../monitor/logger";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly retryAfterMs: number | null,
    message: string
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export class HardBlockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HardBlockError";
  }
}

export function isRetryable(err: unknown): boolean {
  if (err instanceof HardBlockError) return false;
  if (err instanceof HttpError) {
    // 429 and 5xx are retryable; other 4xx mean "you are blocked/wrong", not "try again".
    return err.status === 429 || err.status >= 500;
  }
  return true; // network resets etc.
}

function backoffMs(attempt: number, retryAfterMs: number | null): number {
  if (retryAfterMs !== null) return retryAfterMs; // the platform told us exactly how long
  const exp = Math.min(config.retry.capMs, config.retry.baseMs * 2 ** attempt);
  return Math.round(exp * Math.random()); // full jitter
}

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  context: Record<string, unknown>
): Promise<T> {
  const log = childLogger({ component: "retry", ...context });
  let lastErr: unknown;
  for (let attempt = 0; attempt < config.retry.maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || attempt === config.retry.maxAttempts - 1) throw err;
      const wait = backoffMs(attempt, err instanceof HttpError ? err.retryAfterMs : null);
      log.warn(
        { attempt: attempt + 1, maxAttempts: config.retry.maxAttempts, waitMs: wait, err: String(err) },
        "retryable failure, backing off"
      );
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

/** Parse a Retry-After header (seconds) into ms. */
export function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const secs = Number(value);
  return Number.isFinite(secs) ? secs * 1000 : null;
}
