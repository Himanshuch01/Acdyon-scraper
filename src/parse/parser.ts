/**
 * Tiered parser with validation — the resilience-to-markup-change story.
 *
 * Tier 1: structured data (JSON-LD / RSS). Changes rarely, survives redesigns.
 * Tier 2: selectors keyed on SEMANTIC attributes (data-job-id, data-testid),
 *         never layout classes like .css-x92kf1.
 * Tier 3 (design-only seam): LLM-assisted extraction — interface exists, not wired.
 *
 * Every record passes through zod validation. A page that yields zero valid
 * records while clearly containing content → ParseDriftError → alert, and
 * NOTHING reaches storage. That's the "silently returned garbage" detector.
 */
import { XMLParser } from "fast-xml-parser";
import { JobListing, JobListingSchema } from "./schema";
import { RawPage } from "../fetch/fetcher";
import { config } from "../config";
import { childLogger } from "../monitor/logger";
import { alert } from "../monitor/alerts";

export class ParseDriftError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParseDriftError";
  }
}

export interface ParseResult {
  listings: JobListing[];
  tier: "json-ld" | "rss" | "selectors";
  validationFailures: number;
  pageLookedEmpty: boolean;
}

const log = childLogger({ component: "parser" });

/** Does the page still contain the expected scaffolding? (block vs legit-empty) */
export function hasListScaffolding(page: RawPage): boolean {
  return /id="job-list"|data-testid="job-list"|<rss|<channel/i.test(page.body);
}

export async function parsePage(page: RawPage, sourceName: string): Promise<ParseResult> {
  const isXml = page.contentType.includes("xml") || page.url.endsWith(".xml");
  const candidates: unknown[] = [];
  let tier: ParseResult["tier"];

  if (isXml) {
    tier = "rss";
    candidates.push(...parseRss(page.body));
  } else {
    const fromLd = parseJsonLd(page.body);
    if (fromLd.length > 0) {
      tier = "json-ld";
      candidates.push(...fromLd);
    } else {
      tier = "selectors";
      log.warn({ url: page.url }, "no JSON-LD found, falling back to semantic selectors");
      candidates.push(...parseSemanticSelectors(page.body));
    }
  }

  // --- validation gate ---
  const valid: JobListing[] = [];
  let failures = 0;
  for (const c of candidates) {
    const r = JobListingSchema.safeParse({ ...(c as object), source: sourceName });
    if (r.success) valid.push(r.data);
    else {
      failures++;
      log.warn({ url: page.url, issues: r.error.issues.map((i) => i.message) }, "record failed validation");
    }
  }

  const pageLookedEmpty = candidates.length === 0;
  const failureRatio = candidates.length > 0 ? failures / candidates.length : 0;

  if (!pageLookedEmpty && (valid.length === 0 || failureRatio > config.parser.maxValidationFailureRatio)) {
    await alert("parse_drift", {
      url: page.url, source: sourceName, candidates: candidates.length, valid: valid.length, failures,
    });
    throw new ParseDriftError(
      `parse drift on ${page.url}: ${candidates.length} candidates, ${valid.length} valid — suspected markup change or soft block`
    );
  }

  if (pageLookedEmpty && hasListScaffolding(page) && !isXml) {
    // Scaffolding intact but no items: could be legit empty — orchestrator decides
    // using the historical baseline. Could also be markup drift that removed items.
    log.warn({ url: page.url }, "page has scaffolding but zero parseable items");
  }

  return { listings: valid, tier, validationFailures: failures, pageLookedEmpty };
}

/* ---------------- Tier 1: structured data ---------------- */

function parseJsonLd(html: string): unknown[] {
  const match = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (!match) return [];
  try {
    const doc = JSON.parse(match[1]);
    const elements = doc?.itemListElement ?? [];
    return elements.map((e: any) => ({
      id: String(e?.item?.identifier ?? ""),
      title: e?.item?.title,
      company: e?.item?.hiringOrganization,
      location: e?.item?.jobLocation,
      url: e?.item?.url,
      postedAt: e?.item?.datePosted,
    }));
  } catch {
    return [];
  }
}

function parseRss(xml: string): unknown[] {
  const parsed = new XMLParser({ ignoreAttributes: true }).parse(xml);
  const items = parsed?.rss?.channel?.item ?? [];
  const arr = Array.isArray(items) ? items : [items];
  return arr.map((it: any) => ({
    id: String(it.guid ?? ""),
    title: it.title,
    company: it.author,
    location: it.category,
    url: it.link,
    postedAt: it.pubDate,
  }));
}

/* --------- Tier 2: semantic-attribute selectors ---------
 * Anchored on data-job-id / data-* — attributes that carry MEANING and survive
 * CSS redesigns. Deliberately does NOT read classes like .css-x92kf1, which is
 * exactly why a markup-v2 redesign is DETECTED instead of silently misparsed. */
function parseSemanticSelectors(html: string): unknown[] {
  const out: unknown[] = [];
  const itemRe = /data-job-id="([^"]+)"[^>]*data-title="([^"]*)"[^>]*data-company="([^"]*)"[^>]*data-location="([^"]*)"[^>]*data-posted="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(html)) !== null) {
    out.push({
      id: m[1],
      title: m[2],
      company: m[3],
      location: m[4],
      postedAt: m[5],
      url: `http://localhost:4040/jobs/${m[1]}`,
    });
  }
  return out;
}

/* Tier 3 seam (design-doc scope): if both tiers fail, hand raw HTML + the zod
 * schema to an LLM and validate its output through the same gate. The point on
 * the call: the fallback CANNOT bypass validation, so it can't poison storage. */
