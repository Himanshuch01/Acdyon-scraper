/**
 * Central tuning knobs for the pipeline.
 * Every number here is a decision you should be able to defend on the call.
 */
export const config = {
  session: {
    // Disposable sessions: rotate identity after N requests or M ms, whichever first.
    maxRequests: 12,
    maxAgeMs: 3 * 60 * 1000,
  },
  pacing: {
    // Base delay between requests; actual delay = base * adaptiveFactor * jitter(0.5–1.5).
    baseMs: 1500,
    // Adaptive bounds: slow down on soft signals, relax on sustained success. Never zero.
    minFactor: 1,
    maxFactor: 8,
    softSignalMultiplier: 1.6,
    recoveryDecay: 0.9,
    // A response slower than this multiple of the rolling median is a soft signal.
    slowResponseMultiple: 2.5,
    // Absolute floor: anything slower than this is a soft signal regardless of baseline
    // (a relative-only check misses a source that is UNIFORMLY slow — found in testing).
    absoluteSlowMs: 3000,
  },
  retry: {
    maxAttempts: 4,
    baseMs: 1000,
    capMs: 15000,
  },
  circuitBreaker: {
    // Soft failures (429/5xx/network) needed to trip; hard failures (403/CAPTCHA) trip instantly.
    softFailureThreshold: 3,
    baseCooldownMs: 10_000,
    maxCooldownMs: 120_000,
  },
  parser: {
    // If a non-empty page yields zero valid records, or more than this share fail
    // schema validation, treat it as markup drift / suspected block — not "no jobs".
    maxValidationFailureRatio: 0.5,
  },
  storage: {
    dir: "data",
    rawArchiveDir: "data/raw",
  },
} as const;
