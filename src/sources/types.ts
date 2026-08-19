import { RawPage } from "../fetch/fetcher";

/**
 * One interface, any source. The fetch/parse/storage layers never care what's
 * behind it — extending to a harder source means writing a new adapter, not
 * touching the pipeline. This is the answer to "how does the design extend?"
 */
export interface Source {
  readonly name: string;
  /** URLs to fetch this run (listing pages / feed URLs). */
  listUrls(): string[];
}

export type { RawPage };
