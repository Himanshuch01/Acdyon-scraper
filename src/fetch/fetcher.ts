/**
 * ResilientFetcher: the composition root of the fetch layer.
 * Every request flows through: circuit breaker gate → pacing → session identity →
 * response classification → retry/backoff decisions.
 *
 * Response classification is where detection-surface awareness lives:
 *  - 429              → soft failure, honor Retry-After
 *  - 403 / CAPTCHA    → hard failure, trip the breaker, burn the session identity
 *  - 5xx / network    → soft failure, retryable
 *  - 200              → success, but the PARSE layer still has to prove it's real data
 */
import { CircuitBreaker } from "./circuitBreaker";
import { AdaptivePacer } from "./pacing";
import { SessionManager, sessionHeaders, storeCookies } from "./identity";
import { HttpError, HardBlockError, withRetry, parseRetryAfter } from "./retry";
import { childLogger } from "../monitor/logger";

export interface RawPage {
  url: string;
  status: number;
  body: string;
  contentType: string;
  fetchedAt: string;
  latencyMs: number;
}

const CAPTCHA_MARKERS = ["captcha", "verify you are human", "cf-challenge", "security check"];

export class ResilientFetcher {
  private sessions = new SessionManager();
  private pacer = new AdaptivePacer();
  private breaker: CircuitBreaker;
  private log = childLogger({ component: "fetcher" });

  constructor(sourceName: string) {
    this.breaker = new CircuitBreaker(sourceName);
  }

  async fetch(url: string): Promise<RawPage> {
    await this.breaker.beforeRequest(); // fail fast while open

    const page = await withRetry(async () => {
      const session = this.sessions.acquire();
      await this.pacer.wait();

      const started = Date.now();
      const log = this.log.child({ sessionId: session.id, url });
      let res: Response;
      try {
        res = await globalThis.fetch(url, { headers: sessionHeaders(session), redirect: "follow" });
      } catch (err) {
        await this.breaker.onFailure("soft", `network error: ${String(err)}`);
        throw err;
      }
      const latencyMs = Date.now() - started;
      session.requestCount++;
      storeCookies(session, res.headers.get("set-cookie"));

      if (this.pacer.observeLatency(latencyMs)) {
        log.warn({ latencyMs, factor: this.pacer.currentFactor }, "soft signal: slow response, pacing increased");
      }

      if (res.status === 429) {
        const retryAfterMs = parseRetryAfter(res.headers.get("retry-after"));
        await this.breaker.onFailure("soft", "HTTP 429");
        this.sessions.burn("429 received");
        log.warn({ status: 429, retryAfterMs }, "rate limited");
        throw new HttpError(429, retryAfterMs, "rate limited");
      }

      const body = await res.text();
      const lower = body.toLowerCase();
      const looksLikeCaptcha = CAPTCHA_MARKERS.some((m) => lower.includes(m));

      if (res.status === 403 || looksLikeCaptcha) {
        await this.breaker.onFailure("hard", looksLikeCaptcha ? "CAPTCHA interstitial" : "HTTP 403");
        this.sessions.burn(looksLikeCaptcha ? "captcha" : "403");
        log.error({ status: res.status, captcha: looksLikeCaptcha }, "hard block detected, identity burned");
        throw new HardBlockError(looksLikeCaptcha ? "CAPTCHA interstitial" : `HTTP ${res.status}`);
      }

      if (res.status >= 500) {
        await this.breaker.onFailure("soft", `HTTP ${res.status}`);
        throw new HttpError(res.status, null, `server error ${res.status}`);
      }
      if (!res.ok) {
        throw new HttpError(res.status, null, `unexpected status ${res.status}`);
      }

      this.breaker.onSuccess();
      this.pacer.onSuccess();
      log.info({ status: res.status, latencyMs, bytes: body.length, factor: this.pacer.currentFactor }, "fetch ok");
      return {
        url,
        status: res.status,
        body,
        contentType: res.headers.get("content-type") ?? "",
        fetchedAt: new Date().toISOString(),
        latencyMs,
      };
    }, { url });

    return page;
  }

  get breakerState() {
    return this.breaker.currentState;
  }
}
