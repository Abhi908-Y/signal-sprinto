import { env, capability } from "@/lib/env";
import { sql } from "@/lib/db/client";
import { fetchQuota } from "@/lib/hunter/client";
import type { Evidence, SizeBand } from "@/lib/types";

/**
 * Company size from Hunter.io Company Enrichment (`/v2/companies/find`).
 *
 * Most companies never state their headcount on their own site, so after the loop `size_band`
 * was almost always `not stated`, and R-22 then held every company that would otherwise have
 * been a Send. This is the second source for that one field. It is still evidence, not a guess:
 * the value is Hunter's employee count, the card names Hunter as the source, and a company
 * Hunter cannot size stays `not stated` exactly as before.
 *
 * It costs one Hunter credit, so it runs only when the site did not state the size and the
 * company otherwise cleared FIT, it respects the same 80% quota guard as contact lookup, and
 * every answer (including "Hunter does not know") is cached per domain so no company is ever
 * looked up twice.
 */

export type CompanySize = {
  sizeBand: SizeBand | null;
  evidence: Evidence | null;
  source: "live" | "cached" | "skipped";
  /** Why there is no size, or where it came from, in a sentence for the loop trace. */
  note: string;
  creditUsed: boolean;
};

const BANDS: { band: SizeBand; max: number }[] = [
  { band: "1-10", max: 10 },
  { band: "11-50", max: 50 },
  { band: "51-200", max: 200 },
  { band: "201-500", max: 500 },
];

function bandForCount(count: number): SizeBand {
  for (const { band, max } of BANDS) if (count <= max) return band;
  return "500+";
}

/** "251-1K" → [251, 1000]; "10K+" → [10000, Infinity]; anything unreadable → null. */
function parseRange(range: string): [number, number] | null {
  const num = (s: string): number | null => {
    const m = /^(\d+(?:\.\d+)?)([kKmM]?)$/.exec(s.trim());
    if (!m) return null;
    const mult = m[2].toLowerCase() === "k" ? 1_000 : m[2].toLowerCase() === "m" ? 1_000_000 : 1;
    return Math.round(parseFloat(m[1]) * mult);
  };
  const plus = /^(.+)\+$/.exec(range.trim());
  if (plus) {
    const lo = num(plus[1]);
    return lo === null ? null : [lo, Infinity];
  }
  const parts = range.split("-");
  if (parts.length !== 2) return null;
  const lo = num(parts[0]);
  const hi = num(parts[1]);
  return lo === null || hi === null ? null : [lo, hi];
}

/**
 * Pure mapping from Hunter's metrics to our five bands. An exact count wins. A range is used
 * only when it cannot straddle a band edge that matters — "251-1K" could be 300 or 900, so it
 * maps to nothing rather than to a guess, while "1K-5K" is safely "500+".
 */
export function sizeBandFromHunter(
  employeesCount: number | null | undefined,
  employeesRange: string | null | undefined,
): SizeBand | null {
  if (typeof employeesCount === "number" && Number.isFinite(employeesCount) && employeesCount > 0) {
    return bandForCount(employeesCount);
  }
  if (!employeesRange) return null;
  const parsed = parseRange(employeesRange);
  if (!parsed) return null;
  const [lo, hi] = parsed;
  if (lo > 500) return "500+";
  const loBand = bandForCount(Math.max(lo, 1));
  const hiBand = hi === Infinity ? "500+" : bandForCount(hi);
  return loBand === hiBand ? loBand : null;
}

/** The sentence the evidence card shows in place of a page quote. */
export function hunterSizeQuote(
  employeesCount: number | null | undefined,
  employeesRange: string | null | undefined,
): string {
  const parts: string[] = [];
  if (typeof employeesCount === "number") parts.push(`${employeesCount} employees`);
  if (employeesRange) parts.push(`range ${employeesRange}`);
  return `Hunter.io company data: ${parts.join(", ")}`;
}

export function hunterSourceUrl(domain: string): string {
  return `https://hunter.io/search/${encodeURIComponent(domain)}`;
}

type CachedRow = { employees_count: number | null; employees_range: string | null };

function fromMetrics(
  domain: string,
  row: CachedRow,
  source: "live" | "cached",
  creditUsed: boolean,
): CompanySize {
  const sizeBand = sizeBandFromHunter(row.employees_count, row.employees_range);
  if (!sizeBand) {
    return {
      sizeBand: null,
      evidence: null,
      source,
      creditUsed,
      note:
        row.employees_count === null && row.employees_range === null
          ? `Hunter has no headcount for ${domain}`
          : `Hunter's range "${row.employees_range}" straddles a size band, so it is not used`,
    };
  }
  return {
    sizeBand,
    evidence: {
      quote: hunterSizeQuote(row.employees_count, row.employees_range),
      url: hunterSourceUrl(domain),
      source: "hunter",
    },
    source,
    creditUsed,
    note: `Hunter.io company data puts ${domain} at ${sizeBand} employees${source === "cached" ? " (cached, no credit used)" : ""}`,
  };
}

const skipped = (note: string): CompanySize => ({
  sizeBand: null,
  evidence: null,
  source: "skipped",
  note,
  creditUsed: false,
});

export async function findCompanySize(domain: string): Promise<CompanySize> {
  try {
    const cached = await sql<CachedRow>`
      SELECT employees_count, employees_range FROM hunter_company_cache WHERE domain = ${domain}`;
    if (cached.length > 0) return fromMetrics(domain, cached[0], "cached", false);
  } catch {
    // Treat a cache failure as a miss.
  }

  if (!capability.hunter()) {
    return skipped("HUNTER_API_KEY is not set, so company size could not be looked up");
  }

  const quota = await fetchQuota();
  if (quota?.guardTripped) {
    return skipped(
      `Hunter quota guard tripped (${quota.used}/${quota.limit} used), so company size was not looked up`,
    );
  }

  try {
    const response = await fetch(
      `https://api.hunter.io/v2/companies/find?domain=${encodeURIComponent(domain)}`,
      {
        headers: { "X-API-KEY": env.hunterApiKey()! },
        signal: AbortSignal.timeout(10_000),
      },
    );

    // 404 means Hunter has no company record: a real answer, cached so it is never paid for again.
    if (!response.ok && response.status !== 404) {
      return skipped(`Hunter company lookup returned HTTP ${response.status}`);
    }

    const json = response.ok
      ? ((await response.json()) as {
          data?: { metrics?: { employees?: string | null; employeesCount?: number | null } };
        })
      : {};
    const row: CachedRow = {
      employees_count:
        typeof json.data?.metrics?.employeesCount === "number"
          ? json.data.metrics.employeesCount
          : null,
      employees_range: json.data?.metrics?.employees ?? null,
    };

    try {
      await sql`
        INSERT INTO hunter_company_cache (domain, employees_count, employees_range)
        VALUES (${domain}, ${row.employees_count}, ${row.employees_range})
        ON CONFLICT (domain) DO NOTHING`;
    } catch {
      // Caching is an optimisation.
    }

    return fromMetrics(domain, row, "live", true);
  } catch (err) {
    return skipped(
      `Hunter company lookup failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
