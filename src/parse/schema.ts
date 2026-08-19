/**
 * The contract every parsed record must satisfy — regardless of which parser
 * tier produced it. This is the answer to "how do you know the parser didn't
 * silently return garbage?": you validate, every record, every run.
 */
import { z } from "zod";

export const JobListingSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/i, "id must look like an id"),
  title: z.string().min(2).max(200),
  company: z.string().min(1).max(200),
  location: z.string().min(1).max(200),
  url: z.string().url(),
  // Plausibility, not just presence: must parse as a date and not be in the future.
  postedAt: z
    .string()
    .refine((s) => !Number.isNaN(Date.parse(s)), "must be a parseable date")
    .refine((s) => Date.parse(s) <= Date.now() + 86_400_000, "posted date in the future?"),
  source: z.string(),
});

export type JobListing = z.infer<typeof JobListingSchema>;
