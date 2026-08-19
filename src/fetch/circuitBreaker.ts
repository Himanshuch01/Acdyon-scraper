/**
 * Circuit breaker, per source: closed → open → half-open → closed.
 *
 * - SOFT failure (429, 5xx, network reset): counts toward the threshold.
 * - HARD failure (403, CAPTCHA): trips instantly — hammering a CAPTCHA page is
 *   the fastest way to get an identity permanently burned.
 * - While OPEN: fail fast, no requests leave the process. Cooldown grows on
 *   repeated trips (10s → 20s → 40s …, capped).
 * - HALF-OPEN after cooldown: exactly one probe request decides the next state.
 */
import { config } from "../config";
import { childLogger } from "../monitor/logger";
import { alert } from "../monitor/alerts";

export type BreakerState = "closed" | "open" | "half-open";
export type FailureKind = "soft" | "hard";

export class CircuitOpenError extends Error {
  constructor(public readonly retryAfterMs: number) {
    super("circuit open: failing fast");
    this.name = "CircuitOpenError";
  }
}

export class CircuitBreaker {
  private state: BreakerState = "closed";
  private softFailures = 0;
  private openedAt = 0;
  private cooldownMs: number = config.circuitBreaker.baseCooldownMs;
  private log = childLogger({ component: "circuit-breaker" });

  constructor(private readonly sourceName: string) {}

  /** Gate every request through this. Throws CircuitOpenError when open. */
  async beforeRequest(): Promise<void> {
    if (this.state === "closed") return;
    if (this.state === "open") {
      const elapsed = Date.now() - this.openedAt;
      if (elapsed < this.cooldownMs) {
        throw new CircuitOpenError(this.cooldownMs - elapsed);
      }
      this.state = "half-open";
      this.log.info({ source: this.sourceName }, "breaker half-open: sending single probe");
    }
  }

  onSuccess() {
    if (this.state !== "closed") {
      this.log.info({ source: this.sourceName, previousState: this.state }, "breaker closed: source recovered");
    }
    this.state = "closed";
    this.softFailures = 0;
    this.cooldownMs = config.circuitBreaker.baseCooldownMs; // reset backoff growth
  }

  async onFailure(kind: FailureKind, detail: string) {
    const hard = kind === "hard";
    this.softFailures = hard ? Infinity : this.softFailures + 1;
    this.log.warn({ source: this.sourceName, kind, detail, softFailures: this.softFailures }, "breaker recorded failure");

    const shouldTrip = hard || this.softFailures >= config.circuitBreaker.softFailureThreshold;
    if (shouldTrip && this.state !== "open") {
      this.state = "open";
      this.openedAt = Date.now();
      this.log.error({ source: this.sourceName, cooldownMs: this.cooldownMs, kind, detail }, "breaker OPEN: failing fast");
      await alert("circuit_open", { source: this.sourceName, kind, detail, cooldownMs: this.cooldownMs });
    } else if (this.state === "half-open") {
      // Probe failed: re-open with a longer cooldown.
      this.state = "open";
      this.openedAt = Date.now();
      this.cooldownMs = Math.min(config.circuitBreaker.maxCooldownMs, this.cooldownMs * 2);
      this.log.error({ source: this.sourceName, cooldownMs: this.cooldownMs }, "probe failed, breaker re-opened with longer cooldown");
    }
  }

  get currentState(): BreakerState {
    return this.state;
  }
}
