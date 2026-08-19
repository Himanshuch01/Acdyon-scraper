/**
 * Storage: JSONL raw archive + dedupe index + run baseline.
 *
 * - Raw archive: every fetched page saved verbatim. Parser bug found next week?
 *   Re-parse history without re-fetching. This is production thinking at zero cost.
 * - Dedupe: stable external ID first, content hash as fallback.
 * - Baseline: listings-per-run history per source — the reference point that lets
 *   you tell "legitimately no new listings" apart from "silently blocked".
 *   (Swap for SQLite/Prisma in production; the interface doesn't change.)
 */
import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import { JobListing } from "../parse/schema";
import { RawPage } from "../fetch/fetcher";
import { config } from "../config";
import { childLogger } from "../monitor/logger";

const log = childLogger({ component: "storage" });

function ensureDirs() {
  fs.mkdirSync(config.storage.rawArchiveDir, { recursive: true });
}

interface State {
  seenIds: string[];
  seenHashes: string[];
  baselines: Record<string, number[]>;
}

function statePath() {
  return path.join(config.storage.dir, "state.json");
}

function loadState(): State {
  ensureDirs();
  if (!fs.existsSync(statePath())) return { seenIds: [], seenHashes: [], baselines: {} };
  return JSON.parse(fs.readFileSync(statePath(), "utf8"));
}

function saveState(s: State) {
  fs.writeFileSync(statePath(), JSON.stringify(s, null, 2));
}

export function archiveRaw(page: RawPage): string {
  ensureDirs();
  const name = `${Date.now()}-${createHash("sha256").update(page.url).digest("hex").slice(0, 10)}.html`;
  const p = path.join(config.storage.rawArchiveDir, name);
  fs.writeFileSync(p, page.body);
  log.info({ url: page.url, archivedTo: p, bytes: page.body.length }, "raw page archived");
  return p;
}

function contentHash(l: JobListing): string {
  return createHash("sha256").update(`${l.title}|${l.company}|${l.location}`).digest("hex");
}

export function dedupeAndStore(listings: JobListing[]): { fresh: JobListing[]; duplicates: number } {
  const state = loadState();
  const seenIds = new Set(state.seenIds);
  const seenHashes = new Set(state.seenHashes);
  const fresh: JobListing[] = [];
  let duplicates = 0;

  for (const l of listings) {
    const h = contentHash(l);
    if (seenIds.has(l.id) || seenHashes.has(h)) {
      duplicates++;
      continue;
    }
    seenIds.add(l.id);
    seenHashes.add(h);
    fresh.push(l);
  }

  state.seenIds = [...seenIds];
  state.seenHashes = [...seenHashes];
  saveState(state);

  if (fresh.length > 0) {
    const out = path.join(config.storage.dir, "listings.jsonl");
    fs.appendFileSync(out, fresh.map((l) => JSON.stringify(l)).join("\n") + "\n");
  }
  log.info({ fresh: fresh.length, duplicates }, "storage write complete");
  return { fresh, duplicates };
}

/** Record this run's count; return the rolling median baseline for the source. */
export function updateBaseline(source: string, count: number): number {
  const state = loadState();
  const history = state.baselines[source] ?? [];
  history.push(count);
  if (history.length > 10) history.shift();
  state.baselines[source] = history;
  saveState(state);
  const sorted = [...history].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

export function getBaseline(source: string): number {
  const state = loadState();
  const history = state.baselines[source] ?? [];
  if (history.length === 0) return -1; // no history yet
  const sorted = [...history].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}
