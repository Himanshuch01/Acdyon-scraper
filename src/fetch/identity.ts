/**
 * Session / identity manager.
 *
 * Strategy: DISPOSABLE short-lived sessions. Each session is one coherent identity
 * (matched UA + client hints + Accept-Language + its own cookie jar) with a request
 * budget. When the budget is spent, the identity is discarded, not reused.
 *
 * Why per-session rotation, not per-request: real users don't change fingerprints
 * between clicks — per-request rotation is both expensive and MORE suspicious.
 * Why disposable, not long-lived trusted: a burned trusted identity is catastrophic;
 * a burned disposable one costs nothing.
 *
 * Header consistency matters: sec-ch-ua and Accept-Language must agree with the
 * claimed User-Agent, so identities are generated as matched SETS, never mixed at random.
 */
import { randomUUID } from "crypto";
import { config } from "../config";

interface Identity {
  userAgent: string;
  secChUa: string;
  acceptLanguage: string;
}

const IDENTITY_POOL: Identity[] = [
  {
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    secChUa: '"Chromium";v="126", "Google Chrome";v="126", "Not-A.Brand";v="99"',
    acceptLanguage: "en-US,en;q=0.9",
  },
  {
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    secChUa: '"Chromium";v="125", "Google Chrome";v="125", "Not-A.Brand";v="99"',
    acceptLanguage: "en-GB,en;q=0.9",
  },
  {
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    secChUa: '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
    acceptLanguage: "en-US,en;q=0.8",
  },
];

export interface Session {
  id: string;
  identity: Identity;
  cookieJar: Map<string, string>;
  requestCount: number;
  createdAt: number;
}

export class SessionManager {
  private current: Session | null = null;
  private sessionsBurned = 0;

  /** Returns a live session, rotating to a fresh identity if the budget is spent. */
  acquire(): Session {
    const s = this.current;
    const expired =
      !s ||
      s.requestCount >= config.session.maxRequests ||
      Date.now() - s.createdAt >= config.session.maxAgeMs;
    if (expired) {
      this.current = this.mint();
    }
    return this.current!;
  }

  /** Discard the current identity immediately (e.g. after a soft block signal). */
  burn(reason: string) {
    if (this.current) {
      this.sessionsBurned++;
      this.current = null;
      return reason;
    }
    return reason;
  }

  get stats() {
    return { sessionsBurned: this.sessionsBurned };
  }

  private mint(): Session {
    const identity = IDENTITY_POOL[Math.floor(Math.random() * IDENTITY_POOL.length)];
    return {
      id: randomUUID().slice(0, 8),
      identity,
      cookieJar: new Map(),
      requestCount: 0,
      createdAt: Date.now(),
    };
  }
}

export function sessionHeaders(session: Session): Record<string, string> {
  const cookie = [...session.cookieJar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  return {
    "User-Agent": session.identity.userAgent,
    "sec-ch-ua": session.identity.secChUa,
    "Accept-Language": session.identity.acceptLanguage,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    ...(cookie ? { Cookie: cookie } : {}),
  };
}

/** Minimal cookie jar: enough to carry server-set cookies across a session. */
export function storeCookies(session: Session, setCookie: string | null) {
  if (!setCookie) return;
  for (const part of setCookie.split(/,(?=[^ ])/)) {
    const [pair] = part.split(";");
    const idx = pair.indexOf("=");
    if (idx > 0) session.cookieJar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
  }
}
