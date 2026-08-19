/**
 * Sandbox job board — a source YOU control.
 *
 * The whole point: you can inject real failure modes on demand via ?chaos=...
 *   429       → rate-limited, with a Retry-After header
 *   captcha   → 403 + CAPTCHA interstitial page
 *   markup-v2 → restructured DOM overnight (no JSON-LD, renamed attributes)
 *   empty     → 200, valid page scaffolding, zero listings (legit empty)
 *   slow      → 4s latency (soft signal for adaptive pacing)
 *
 * Without this, your resilience logic is untestable theory. With it, every
 * failure/recovery claim in DECISIONS.md has a reproducible demo.
 */
import express from "express";
import { generateJobs, TOTAL_PAGES, SandboxJob } from "./jobs";

const app = express();
const PORT = Number(process.env.SANDBOX_PORT ?? 4040);

function renderJobsPageV1(jobs: SandboxJob[], page: number): string {
  const items = jobs
    .map(
      (j) => `
      <li class="job-card" data-job-id="${j.id}" data-title="${j.title}" data-company="${j.company}"
          data-location="${j.location}" data-posted="${j.postedAt}">
        <a href="/jobs/${j.id}">${j.title} @ ${j.company}</a>
      </li>`
    )
    .join("");

  // Tier-1 structured data: JSON-LD. This is what a resilient parser reads FIRST.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: jobs.map((j, i) => ({
      "@type": "ListItem",
      position: (page - 1) * 6 + i + 1,
      item: {
        "@type": "JobPosting",
        identifier: j.id,
        title: j.title,
        hiringOrganization: j.company,
        jobLocation: j.location,
        datePosted: j.postedAt,
        url: `http://localhost:${PORT}/jobs/${j.id}`,
      },
    })),
  };

  return `<!doctype html><html><head><title>Sandbox Jobs — page ${page}</title>
  <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
  </head><body>
  <main>
    <ul id="job-list" data-testid="job-list">${items}
    </ul>
    <nav>Page ${page} of ${TOTAL_PAGES}</nav>
  </main></body></html>`;
}

/** Overnight redesign: no JSON-LD, attributes renamed, classes hashed. */
function renderJobsPageV2(jobs: SandboxJob[]): string {
  const items = jobs
    .map(
      (j) => `
      <div class="css-x92kf1" data-v2-ref="${j.id}" data-v2-name="${j.title}">
        <span class="css-zz11aa">${j.title} — ${j.company}, ${j.location}</span>
      </div>`
    )
    .join("");
  return `<!doctype html><html><head><title>Jobs — New Look!</title></head><body>
  <div id="results" class="css-m38dj2">${items}
  </div></body></html>`;
}

function renderEmptyPage(): string {
  // Scaffolding intact, zero listings — a LEGITIMATE empty result.
  return `<!doctype html><html><head><title>Sandbox Jobs</title></head><body>
  <main><ul id="job-list" data-testid="job-list"></ul>
  <p>No openings right now.</p></main></body></html>`;
}

function renderCaptcha(): string {
  return `<!doctype html><html><head><title>Security check</title></head><body>
  <h1>Please verify you are human</h1>
  <div class="captcha-challenge" id="cf-challenge">[captcha widget]</div>
  </body></html>`;
}

app.use((req, _res, next) => {
  // Server-side log: what the "platform" sees. Useful on the call.
  console.log(`[sandbox] ${req.method} ${req.originalUrl} ua="${req.headers["user-agent"]}"`);
  next();
});

app.get("/jobs", async (req, res) => {
  const chaos = String(req.query.chaos ?? "");
  const page = Math.max(1, Math.min(TOTAL_PAGES, Number(req.query.page ?? 1) || 1));

  switch (chaos) {
    case "429":
      res.set("Retry-After", "2").status(429).send("Too Many Requests");
      return;
    case "captcha":
      res.status(403).type("html").send(renderCaptcha());
      return;
    case "empty":
      res.type("html").send(renderEmptyPage());
      return;
    case "slow":
      await new Promise((r) => setTimeout(r, 4000));
      break;
  }

  if (chaos === "markup-v2") {
    res.type("html").send(renderJobsPageV2(generateJobs(page)));
    return;
  }
  if (chaos === "markup-v3") {
    // Sneakier: keeps the v1 attributes, but the values are subtly wrong —
    // exactly the "parser silently returned garbage" trap. Only schema
    // validation catches this one.
    const jobs = generateJobs(page).map((j) => ({ ...j, postedAt: "yesterday", id: `??${j.id}` }));
    res.type("html").send(renderJobsPageV1(jobs, page));
    return;
  }
  res.type("html").send(renderJobsPageV1(generateJobs(page), page));
});

// RSS flavor of the same sandbox, so the RSS adapter path is testable offline.
app.get("/feed.xml", (_req, res) => {
  const jobs = generateJobs(1, 18);
  const items = jobs
    .map(
      (j) => `<item><guid>${j.id}</guid><title>${j.title}</title><author>${j.company}</author>
      <category>${j.location}</category><pubDate>${new Date(j.postedAt).toUTCString()}</pubDate>
      <link>http://localhost:${PORT}/jobs/${j.id}</link></item>`
    )
    .join("\n");
  res.type("application/rss+xml").send(
    `<?xml version="1.0"?><rss version="2.0"><channel>
    <title>Sandbox Jobs Feed</title>${items}</channel></rss>`
  );
});

app.listen(PORT, () => {
  console.log(`[sandbox] fake job board on http://localhost:${PORT}`);
  console.log(`[sandbox] chaos modes: ?chaos=429 | captcha | markup-v2 | empty | slow`);
});
