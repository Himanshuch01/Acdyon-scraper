# AcdyOn Scraper — Resilient Job-Listing Ingestion Pipeline

> **Node.js + TypeScript.** A production-grade web scraping pipeline built to survive — and *demonstrably* survive — rate limits, CAPTCHAs, overnight markup changes, and silent blocks.

[![Live Demo](https://img.shields.io/badge/Live%20Demo-Render-46E3B7?style=flat-square&logo=render)](https://acdyon-scraper-31yr.onrender.com/jobs?page=1)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-22+-339933?style=flat-square&logo=node.js)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-ISC-blue?style=flat-square)](LICENSE)

---

## 🌐 Live Demo

The sandbox job board is deployed and publicly accessible:

| Endpoint | Description |
|----------|-------------|
| [`/jobs?page=1`](https://acdyon-scraper-31yr.onrender.com/jobs?page=1) | Happy path — 6 listings with JSON-LD structured data |
| [`/jobs?page=1&chaos=429`](https://acdyon-scraper-31yr.onrender.com/jobs?page=1&chaos=429) | Rate limit — `Retry-After` header honored |
| [`/jobs?page=1&chaos=captcha`](https://acdyon-scraper-31yr.onrender.com/jobs?page=1&chaos=captcha) | Hard CAPTCHA block — instant circuit trip |
| [`/jobs?page=1&chaos=markup-v2`](https://acdyon-scraper-31yr.onrender.com/jobs?page=1&chaos=markup-v2) | Overnight redesign — parse drift detected |
| [`/jobs?page=1&chaos=markup-v3`](https://acdyon-scraper-31yr.onrender.com/jobs?page=1&chaos=markup-v3) | Silent garbage — Zod schema catches it |
| [`/jobs?page=1&chaos=empty`](https://acdyon-scraper-31yr.onrender.com/jobs?page=1&chaos=empty) | Empty page — disambiguated vs. baseline |
| [`/jobs?page=1&chaos=slow`](https://acdyon-scraper-31yr.onrender.com/jobs?page=1&chaos=slow) | 4s latency — adaptive pacing factor rises |
| [`/feed.xml`](https://acdyon-scraper-31yr.onrender.com/feed.xml) | RSS flavor — same data, XML format |

---

## 🏗️ Architecture

```
Source adapter ──▶ ResilientFetcher ──▶ Tiered Parser ──▶ Zod Gate ──▶ Storage ──▶ Monitor
(sandbox | rss)   (breaker → pacer →   (json-ld → rss →  (garbage    (dedupe +   (pino logs +
                   session → retry)     selectors; LLM     never      raw archive) webhook alerts)
                                        seam designed)     stored)
```

Every failure mode is **reproducible on command** via the sandbox's `?chaos=` parameter — not simulated in tests, but exercised end-to-end through the full pipeline stack.

---

## 🔍 What problem does this solve?

Scraping job boards like LinkedIn, Indeed, or Naukri at scale means surviving:

- **Bot detection** — headless fingerprints, timing patterns, missing headers
- **Rate limits** — 429s with `Retry-After`, IP-level throttling
- **Hard blocks** — CAPTCHA walls, 403s that should never be retried
- **Markup drift** — sites redesign overnight; naive scrapers silently return nothing
- **Silent failures** — a page returns 200 with zero results; is that real, or a block?

This pipeline answers each of those with a designed, tested component.

---

## 📁 Codebase Map

| File | What it does |
|------|-------------|
| [`src/fetch/circuitBreaker.ts`](src/fetch/circuitBreaker.ts) | Stops the pipeline hammering a source that's blocking us. Hard failures (CAPTCHA/403) trip instantly; soft ones (429) count to 3. |
| [`src/fetch/pacing.ts`](src/fetch/pacing.ts) | Fixed intervals are a bot tell. Jitter + adaptive factor reacts to slow responses. Has an *absolute* latency floor — relative-only check misses uniformly-slow sources (found in real testing). |
| [`src/fetch/identity.ts`](src/fetch/identity.ts) | Disposable sessions with matched browser header sets. Rotation is per-session — per-request changes are both costly and more suspicious. |
| [`src/fetch/retry.ts`](src/fetch/retry.ts) | Exponential backoff with full jitter. Honors `Retry-After`. Refuses to retry hard blocks. |
| [`src/fetch/fetcher.ts`](src/fetch/fetcher.ts) | Composes the four above. Classifies every response: soft-fail / hard-fail / success. |
| [`src/parse/parser.ts`](src/parse/parser.ts) | Structured data first (JSON-LD survives redesigns), semantic-attribute selectors second, LLM seam third. Zero-trust on its own output. |
| [`src/parse/schema.ts`](src/parse/schema.ts) | Zod contract with plausibility checks — the "parser silently returned garbage" detector. |
| [`src/storage/store.ts`](src/storage/store.ts) | Dedupe + raw archive (re-parse history without re-fetching) + per-source baseline for empty-response disambiguation. Swap for Prisma/SQLite in production; interface unchanged. |
| [`src/index.ts`](src/index.ts) | Orchestrator. Owns the empty-vs-blocked decision using scaffolding checks + baseline. |
| [`src/sandbox/server.ts`](src/sandbox/server.ts) | The controlled source that makes every failure mode reproducible on command. |

---

## ⚡ Quick Start

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Terminal 1 — start the fake job board
node dist/sandbox/server.js

# Terminal 2 — run the pipeline against it
node dist/index.js --source=sandbox                  # happy path: 18 listings, JSON-LD tier
node dist/index.js --source=sandbox                  # again → 18/18 deduped ✓
node dist/index.js --source=sandbox --chaos=429      # rate limit: Retry-After honored, breaker trips
node dist/index.js --source=sandbox --chaos=captcha  # hard block: instant trip, run aborts
node dist/index.js --source=sandbox --chaos=markup-v2   # redesign: drift detected, nothing stored
node dist/index.js --source=sandbox --chaos=markup-v3   # silent garbage: Zod catches every record
node dist/index.js --source=sandbox --chaos=empty    # empty: disambiguated vs baseline
node dist/index.js --source=sandbox --chaos=slow     # latency: pacing factor climbs visibly

# Against the live deployed sandbox
node dist/index.js --source=rss
# with FEED_URL=https://acdyon-scraper-31yr.onrender.com/feed.xml
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `FEED_URL` | — | RSS feed URL for `--source=rss` mode |
| `ALERT_WEBHOOK` | — | Slack/Discord webhook URL for real alerts |
| `SANDBOX_PORT` | `4040` | Local sandbox server port |
| `BASE_URL` | auto | Public base URL (set automatically on Render) |

---

## 🔴 Chaos Mode Evidence

Real log output from actual failure/recovery runs:

### 429 Rate Limit — identity burned, breaker trips at 3
```json
{"component":"fetcher","sessionId":"e9f4f74d","status":429,"retryAfterMs":2000,"msg":"rate limited"}
{"component":"retry","attempt":1,"waitMs":2000,"msg":"retryable failure, backing off"}
{"component":"fetcher","sessionId":"77f1ce91","status":429,"msg":"rate limited"}
{"component":"circuit-breaker","cooldownMs":10000,"msg":"breaker OPEN: failing fast"}
{"alert":{"event":"circuit_open","source":"sandbox","kind":"soft","detail":"HTTP 429"}}
```
> Note: `sessionId` changes on every 429 — the identity is burned, not retried.

### CAPTCHA Hard Block — instant trip, no hammering
```json
{"component":"circuit-breaker","kind":"hard","detail":"CAPTCHA interstitial","msg":"breaker OPEN: failing fast"}
{"component":"fetcher","status":403,"captcha":true,"msg":"hard block detected, identity burned"}
{"component":"orchestrator","err":"HardBlockError: CAPTCHA interstitial","msg":"hard block — aborting run"}
```

### Markup Redesign (v2) — parse drift, nothing reaches storage
```json
{"component":"parser","msg":"no JSON-LD found, falling back to semantic selectors"}
{"component":"orchestrator","tier":"selectors","parsed":0,"msg":"page parsed"}
{"alert":{"event":"suspected_silent_block","reason":"scaffolding missing"}}
{"component":"orchestrator","err":"ParseDriftError","msg":"parse drift detected — nothing from this page reached storage"}
```

### Silent Garbage (v3) — Zod catches what the parser missed
```json
{"component":"parser","issues":["id must look like an id","must be a parseable date","posted date in the future?"],"msg":"record failed validation"}
```

### Slow Source — adaptive pacing factor climbs visibly
```json
{"component":"fetcher","latencyMs":4046,"factor":1.6,"msg":"soft signal: slow response, pacing increased"}
{"component":"fetcher","latencyMs":4003,"factor":2.304,"msg":"soft signal: slow response, pacing increased"}
{"component":"fetcher","latencyMs":4004,"factor":3.31,"msg":"soft signal: slow response, pacing increased"}
```

---

## 🚧 Out of Scope (Designed, Not Built)

The following were deliberately cut — each has a designed seam in the code:

- **TLS/JA3 fingerprinting** — `identity.ts` has a hook for injecting a custom TLS client
- **Residential proxy rotation** — `fetcher.ts` accepts an agent factory; swap in a proxy pool
- **Wired LLM parse fallback** — `parser.ts` has an explicit `// LLM SEAM` comment
- **Multi-worker distribution** — storage interface is swap-ready for a shared DB

These were cut because the sanctioned demo sources don't exercise them — not because they weren't considered.

---

## 🧭 Where We'd Stop (ToS & Ethics)

The live demo runs against a **sandbox we control** — not a live LinkedIn or Indeed account. The design accounts for ToS boundaries:

- Real runs use public RSS/API endpoints only
- No credential stuffing, no account simulation
- Rate limits are respected, not worked around
- The pipeline is designed to back off gracefully, not to escalate

---

## 🛠️ Tech Stack

- **Runtime:** Node.js 22+, TypeScript 5.6
- **Web server:** Express 5 (sandbox)
- **Validation:** Zod 4
- **Parsing:** fast-xml-parser (RSS), custom JSON-LD + CSS selector tiers
- **Logging:** Pino (structured JSON)
- **Deployment:** Render (free tier)
