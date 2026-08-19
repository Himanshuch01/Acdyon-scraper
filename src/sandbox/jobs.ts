/** Deterministic fake dataset for the sandbox job board. */
export interface SandboxJob {
  id: string;
  title: string;
  company: string;
  location: string;
  postedAt: string; // ISO date
}

const COMPANIES = ["Northwind Labs", "Acme Systems", "BlueRiver AI", "Kite & Anchor", "Helios Health", "Ferrous Works"];
const TITLES = ["Frontend Engineer", "Backend Engineer", "ML Intern", "Platform Engineer", "Data Analyst", "DevOps Engineer", "Product Engineer", "QA Engineer"];
const LOCATIONS = ["Bengaluru", "Remote", "Hyderabad", "Pune", "Chennai", "Mumbai"];

export function generateJobs(page: number, perPage = 6): SandboxJob[] {
  // Deterministic: same page always yields the same jobs (stable IDs enable dedupe testing).
  const jobs: SandboxJob[] = [];
  const start = (page - 1) * perPage;
  const total = 18; // 3 pages of 6
  for (let i = start; i < Math.min(start + perPage, total); i++) {
    const posted = new Date(Date.now() - (i + 1) * 36e5 * 24); // i+1 days ago
    jobs.push({
      id: `job-${1000 + i}`,
      title: TITLES[i % TITLES.length],
      company: COMPANIES[i % COMPANIES.length],
      location: LOCATIONS[i % LOCATIONS.length],
      postedAt: posted.toISOString().slice(0, 10),
    });
  }
  return jobs;
}

export const TOTAL_PAGES = 3;
