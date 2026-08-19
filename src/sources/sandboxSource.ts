import { Source } from "./types";

/** The controlled sandbox board. chaos mode passed through for failure demos. */
export class SandboxSource implements Source {
  readonly name = "sandbox";
  constructor(
    private baseUrl = process.env.SANDBOX_URL ?? "http://localhost:4040",
    private chaos = "",
    private pages = 3
  ) {}

  listUrls(): string[] {
    const q = this.chaos ? `&chaos=${this.chaos}` : "";
    return Array.from({ length: this.pages }, (_, i) => `${this.baseUrl}/jobs?page=${i + 1}${q}`);
  }
}
