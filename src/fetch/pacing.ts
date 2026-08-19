/**
 * Pacing: jittered + adaptive. Never a fixed interval.
 *
 * - delay = baseMs * adaptiveFactor * uniform(0.5, 1.5)
 * - adaptiveFactor rises on SOFT signals (slow responses, a first 429) and
 *   decays back toward 1 on sustained success — with a hard floor.
 *
 * Why adaptive beats fixed: perfectly regular intervals are a behavioral bot tell,
 * and a fixed delay can't react to a source that is quietly struggling.
 */
import { config } from "../config";

export class AdaptivePacer {
  private factor = 1;
  private latencyWindow: number[] = [];

  /** Call before every request. */
  async wait(): Promise<number> {
    const jitter = 0.5 + Math.random();
    const delay = Math.round(config.pacing.baseMs * this.factor * jitter);
    await new Promise((r) => setTimeout(r, delay));
    return delay;
  }

  /** Record an observed latency; returns true if it looked like a soft signal. */
  observeLatency(ms: number): boolean {
    this.latencyWindow.push(ms);
    if (this.latencyWindow.length > 20) this.latencyWindow.shift();
    const median = [...this.latencyWindow].sort((a, b) => a - b)[
      Math.floor(this.latencyWindow.length / 2)
    ];
    // Relative spike vs rolling median OR absolute floor — a relative-only detector
    // misses the case where EVERY response is uniformly slow (found in testing).
    const relativeSpike =
      this.latencyWindow.length >= 3 && ms > median * config.pacing.slowResponseMultiple;
    const absoluteSlow = ms > config.pacing.absoluteSlowMs;
    const slow = relativeSpike || absoluteSlow;
    if (slow) this.onSoftSignal(relativeSpike ? "latency_spike" : "latency_absolute");
    return slow;
  }

  onSoftSignal(kind: string) {
    const before = this.factor;
    this.factor = Math.min(config.pacing.maxFactor, this.factor * config.pacing.softSignalMultiplier);
    return { kind, before, after: this.factor };
  }

  onSuccess() {
    this.factor = Math.max(config.pacing.minFactor, this.factor * config.pacing.recoveryDecay);
  }

  get currentFactor() {
    return this.factor;
  }
}
