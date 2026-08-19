# Captured demo evidence — real log lines from real failure/recovery cycles

Captured from actual chaos runs. On the call: "show me" → show these, or better,
reproduce them live in under a minute each.

## 1. 429: Retry-After honored, identity rotated per soft block, breaker trips at 3

```json
{"component":"fetcher","sessionId":"e9f4f74d","status":429,"retryAfterMs":2000,"msg":"rate limited"}
{"component":"retry","attempt":1,"waitMs":2000,"msg":"retryable failure, backing off"}
{"component":"fetcher","sessionId":"77f1ce91","status":429,"msg":"rate limited"}
{"component":"circuit-breaker","cooldownMs":10000,"msg":"breaker OPEN: failing fast"}
{"alert":{"event":"circuit_open","source":"sandbox","kind":"soft","detail":"HTTP 429"}}
```

Note the sessionId changes on every 429 — the identity is burned, not retried.

## 2. CAPTCHA: hard block → instant trip → run aborts (no hammering)

```json
{"component":"circuit-breaker","kind":"hard","detail":"CAPTCHA interstitial","msg":"breaker OPEN: failing fast"}
{"component":"fetcher","status":403,"captcha":true,"msg":"hard block detected, identity burned"}
{"component":"orchestrator","err":"HardBlockError: CAPTCHA interstitial","msg":"hard block — aborting run for this source"}
```

## 3. markup-v2 (redesign): drift detected, nothing reaches storage

```json
{"component":"parser","msg":"no JSON-LD found, falling back to semantic selectors"}
{"component":"orchestrator","tier":"selectors","parsed":0,"msg":"page parsed"}
{"alert":{"event":"suspected_silent_block","reason":"scaffolding missing"}}
{"component":"orchestrator","err":"ParseDriftError: page ... lacks expected scaffolding","msg":"parse drift detected — nothing from this page reached storage"}
```

## 4. markup-v3 (silent garbage): schema validation catches every record

```json
{"component":"parser","issues":["id must look like an id","must be a parseable date","posted date in the future?"],"msg":"record failed validation"}
```

Selectors "worked" — the page parsed. Only the zod gate kept garbage out of storage.

## 5. Empty response: two different verdicts from the same zero-listing page

Healthy baseline (18) → flagged:
```json
{"alert":{"event":"suspected_silent_block","baseline":18,"reason":"sudden drop from healthy baseline"}}
```
Fresh baseline → accepted as legitimate:
```json
{"component":"orchestrator","msg":"zero listings, scaffolding intact, baseline low — treating as legitimately empty"}
```

## 6. Slow source: adaptive pacing factor climbs in view (1 → 1.6 → 2.3 → 3.3)

```json
{"component":"fetcher","latencyMs":4046,"factor":1.6,"msg":"soft signal: slow response, pacing increased"}
{"component":"fetcher","latencyMs":4003,"factor":2.304,"msg":"soft signal: slow response, pacing increased"}
{"component":"fetcher","latencyMs":4004,"factor":3.31,"msg":"soft signal: slow response, pacing increased"}
```

## 7. Dedupe: identical re-run

```json
{"component":"storage","fresh":0,"duplicates":6,"msg":"storage write complete"}
{"component":"orchestrator","totalListings":18,"fresh":0,"duplicates":18,"msg":"run finished"}
```
