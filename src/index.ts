/**
 * Orchestrator: source → resilient fetch → tiered parse + validation →
 * dedupe/storage → baseline tracking → alerts.
 *
 * Usage:
 *   node dist/index.js --source=sandbox                 # happy path vs sandbox
 *   node dist/index.js --source=sandbox --chaos=429     # inject a failure mode
 *   node dist/index.js --source=rss                     # real feed (FEED_URL=...)
 */
import { SandboxSource } from "./sources/sandboxSource";
import { RssSource } from "./sources/rssSource";
import { Source } from "./sources/types";
import { ResilientFetcher } from "./fetch/fetcher";
import { parsePage, hasListScaffolding, ParseDriftError } from "./parse/parser";
import { archiveRaw, dedupeAndStore, getBaseline, updateBaseline } from "./storage/store";
import { HardBlockError } from "./fetch/retry";
import { CircuitOpenError } from "./fetch/circuitBreaker";
import { childLogger, runId } from "./monitor/logger";
import { alert } from "./monitor/alerts";

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.split("=")[1];
}

function pickSource(): Source {
  const which = arg("source") ?? "sandbox";
  if (which === "rss") return new RssSource();
  return new SandboxSource(undefined, arg("chaos") ?? "");
}

/**
 * The silent-failure disambiguator. Zero listings is a legitimate outcome —
 * but ONLY if the page scaffolding is intact and the historical baseline says
 * emptiness is plausible. Otherwise it's a suspected silent block / drift.
 */
async function interpretEmpty(source: Source, url: string, scaffoldingIntact: boolean) {
  const baseline = getBaseline(source.name);
  if (!scaffoldingIntact) {
    await alert("suspected_silent_block", { source: source.name, url, reason: "scaffolding missing" });
    throw new ParseDriftError(`page from ${url} lacks expected scaffolding — suspected block, not "no jobs"`);
  }
  if (baseline > 3) {
    await alert("suspected_silent_block", { source: source.name, url, baseline, reason: "sudden drop from healthy baseline" });
    log.warn({ baseline }, "zero listings against a healthy baseline — flagged for review, not trusted");
  } else {
    log.info({ baseline }, "zero listings, scaffolding intact, baseline low — treating as legitimately empty");
  }
}

const log = childLogger({ component: "orchestrator" });

async function main() {
  const source = pickSource();
  const fetcher = new ResilientFetcher(source.name);
  const runLog = log.child({ source: source.name });
  runLog.info({ urls: source.listUrls() }, `run ${runId} started`);

  let totalFresh = 0;
  let totalDupes = 0;
  let pagesFetched = 0;
  let totalListings = 0;

  for (const url of source.listUrls()) {
    let page;
    try {
      page = await fetcher.fetch(url);
    } catch (err) {
      if (err instanceof CircuitOpenError) {
        runLog.warn({ url, retryInMs: err.retryAfterMs }, "circuit open — skipping URL, work stays queued");
        continue; // fail fast, don't hammer
      }
      if (err instanceof HardBlockError) {
        runLog.error({ url, err: String(err) }, "hard block — aborting run for this source");
        break; // plan B: stop this source, alert already fired
      }
      runLog.error({ url, err: String(err) }, "fetch failed after retries — continuing with next URL");
      continue; // degrade: partial data + alert beats a dead pipeline
    }

    pagesFetched++;
    archiveRaw(page);

    try {
      const result = await parsePage(page, source.name);
      runLog.info({ url, tier: result.tier, parsed: result.listings.length, validationFailures: result.validationFailures }, "page parsed");
      totalListings += result.listings.length;

      if (result.listings.length === 0) {
        await interpretEmpty(source, url, hasListScaffolding(page));
        continue;
      }
      const { fresh, duplicates } = dedupeAndStore(result.listings);
      totalFresh += fresh.length;
      totalDupes += duplicates;
    } catch (err) {
      if (err instanceof ParseDriftError) {
        runLog.error({ url, err: String(err) }, "parse drift detected — nothing from this page reached storage");
        continue;
      }
      throw err;
    }
  }

  if (totalListings > 0) updateBaseline(source.name, totalListings);

  runLog.info(
    { pagesFetched, totalListings, fresh: totalFresh, duplicates: totalDupes, breakerState: fetcher.breakerState },
    `run ${runId} finished`
  );
}

main().catch(async (err) => {
  log.error({ err: String(err) }, "run failed");
  await alert("run_failed", { error: String(err) });
  process.exitCode = 1;
});
