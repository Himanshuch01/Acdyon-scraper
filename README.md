# AcdyOn Part 1 — Resilient Job-Listing Ingestion Pipeline

Node.js + TypeScript. Hybrid sources: a self-built sandbox job board (with chaos
controls) + any real public RSS feed. Built to survive — and *demonstrably* survive —
rate limits, CAPTCHAs, overnight markup changes, and silent blocks.

## Quick start

```bash
npm install
npm run build

# terminal 1: the fake job board you control
node dist/sandbox/server.js

# terminal 2: the pipeline
node dist/index.js --source=sandbox                 # happy path (18 listings, JSON-LD tier)
node dist/index.js --source=sandbox                 # again → 18/18 deduped
node dist/index.js --source=sandbox --chaos=429     # rate limit: Retry-After honored, breaker trips, alert
node dist/index.js --source=sandbox --chaos=captcha # hard block: instant breaker trip, run aborts
node dist/index.js --source=sandbox --chaos=markup-v2  # redesign: drift detected, nothing reaches storage
node dist/index.js --source=sandbox --chaos=markup-v3  # silent garbage: zod validation catches it
node dist/index.js --source=sandbox --chaos=empty      # empty: disambiguated vs baseline
node dist/index.js --source=sandbox --chaos=slow       # latency: adaptive pacing factor rises visibly
FEED_URL=https://some-public-board.com/jobs.rss node dist/index.js --source=rss  # real feed
```

Set `ALERT_WEBHOOK=<slack/discord webhook>` to see real alerts fire.

## Architecture (draw this from memory before the call)

```
Source adapter ──▶ ResilientFetcher ──▶ tiered Parser ──▶ zod gate ──▶ Storage ──▶ Monitor
(sandbox | rss)    (breaker→pacer→       (json-ld → rss →   (garbage    (dedupe +   (pino logs +
                    session→retry)        selectors; LLM      never      raw archive) webhook alerts)
                                         seam designed)       stored)
```

## What each file is FOR (the one-sentence defense)

| File | If they ask "why does this exist?" |
|---|---|
| `src/fetch/circuitBreaker.ts` | Stops the pipeline from hammering a source that's actively blocking us; hard failures (CAPTCHA/403) trip instantly, soft ones (429) count to 3. |
| `src/fetch/pacing.ts` | Fixed intervals are a bot tell; jitter + adaptive factor reacts to soft signals. Has an absolute latency floor *and* a relative check — relative alone misses uniformly-slow sources (found in testing). |
| `src/fetch/identity.ts` | Disposable sessions with matched header sets; rotation is per-session because per-request identity changes are both costly and more suspicious. |
| `src/fetch/retry.ts` | Exponential backoff with full jitter, honors `Retry-After`, refuses to retry hard blocks. |
| `src/fetch/fetcher.ts` | Composes the four above; classifies every response into soft-fail / hard-fail / success. |
| `src/parse/parser.ts` | Structured data first (survives redesigns), semantic-attribute selectors second, LLM seam third; zero-trust on its own output. |
| `src/parse/schema.ts` | zod contract with plausibility checks — the "parser silently returned garbage" detector. |
| `src/storage/store.ts` | Dedupe + raw archive (re-parse history without re-fetching) + per-source baseline for empty-response disambiguation. Swap for Prisma/SQLite in production, interface unchanged. |
| `src/index.ts` | Orchestrator; owns the empty-vs-blocked decision using scaffolding checks + baseline. |
| `src/sandbox/server.ts` | The controlled source that makes every failure mode reproducible on command. |

## Explicitly out of demo scope (designed, not built — say this first)

TLS/JA3 fingerprinting, residential proxy rotation, wired LLM parse fallback,
multi-worker distribution. Each has a designed seam; each was cut deliberately
because the sanctioned sources don't exercise it.

## The testing artifact worth mentioning unprompted

During chaos testing, the relative-latency soft-signal check missed a uniformly
slow source (median ≈ every observation). Fixed by adding `absoluteSlowMs`.
That's the kind of line that proves the resilience logic was *tested*, not assumed.
