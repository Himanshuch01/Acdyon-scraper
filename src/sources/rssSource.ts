import { Source } from "./types";

/**
 * Real public RSS source. RSS is the sanctioned, low-risk lane: the source has
 * deliberately published a machine-readable feed. Point FEED_URL at any public
 * job-board RSS (e.g. a Greenhouse/Lever board). Defaults to the sandbox's own
 * feed so the RSS code path is testable fully offline.
 */
export class RssSource implements Source {
  readonly name = "rss";
  constructor(private feedUrl = process.env.FEED_URL ?? "http://localhost:4040/feed.xml") {}

  listUrls(): string[] {
    return [this.feedUrl];
  }
}
