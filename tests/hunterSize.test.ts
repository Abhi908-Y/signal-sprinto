import { describe, it, expect } from "vitest";
import { sizeBandFromHunter, hunterSizeQuote } from "@/lib/hunter/company";
import { computeVerdict } from "@/lib/rules/verdict";
import { applyHandoffRules } from "@/lib/pipeline/runCompany";
import { emptyFields } from "@/lib/pipeline/completeness";
import type { FiredSignal } from "@/lib/types";
import { fittingEvidence, switches, weights } from "./helpers";

const signal = (
  signal_id: FiredSignal["signal_id"],
  points: number,
  group: FiredSignal["independence_group"],
): FiredSignal => ({
  signal_id,
  points,
  independence_group: group,
  quote: "a sufficiently long verbatim sentence taken from the page",
  source_url: "https://example.com/",
});

describe("Hunter company size → size_band", () => {
  it("uses the exact employee count when Hunter has one", () => {
    expect(sizeBandFromHunter(318, "251-1K")).toBe("201-500");
    expect(sizeBandFromHunter(8, null)).toBe("1-10");
    expect(sizeBandFromHunter(50, null)).toBe("11-50");
    expect(sizeBandFromHunter(51, null)).toBe("51-200");
    expect(sizeBandFromHunter(500, null)).toBe("201-500");
    expect(sizeBandFromHunter(501, null)).toBe("500+");
  });

  it("uses a range only when it cannot straddle a band edge", () => {
    expect(sizeBandFromHunter(null, "11-50")).toBe("11-50");
    expect(sizeBandFromHunter(null, "1K-5K")).toBe("500+");
    expect(sizeBandFromHunter(null, "10K+")).toBe("500+");
    // 251–1,000 could be 300 or 900: on either side of the R-02 line, so no answer.
    expect(sizeBandFromHunter(null, "251-1K")).toBeNull();
    expect(sizeBandFromHunter(null, "51-250")).toBeNull();
  });

  it("returns nothing rather than guessing when Hunter has nothing", () => {
    expect(sizeBandFromHunter(null, null)).toBeNull();
    expect(sizeBandFromHunter(0, null)).toBeNull();
    expect(sizeBandFromHunter(null, "unknown")).toBeNull();
  });

  it("names Hunter as the source in the evidence sentence", () => {
    expect(hunterSizeQuote(318, "251-1K")).toBe(
      "Hunter.io company data: 318 employees, range 251-1K",
    );
  });
});

describe("Hunter size in the verdict", () => {
  // rocketlane.com's real run: S-02 + S-06 + S-07 at default weights = 55 across 3 groups.
  const fired = [
    signal("S-02", 30, "certification"),
    signal("S-06", 10, "funding"),
    signal("S-07", 15, "vertical"),
  ];
  const hunterEvidence = {
    quote: "Hunter.io company data: 318 employees, range 251-1K",
    url: "https://hunter.io/search/rocketlane.com",
    source: "hunter" as const,
  };

  it("without a size, R-22 holds a company that would otherwise be a Send", () => {
    const evidence = fittingEvidence({ size_band: null, size_band_evidence: null });
    const result = applyHandoffRules(computeVerdict(evidence, fired, weights(), switches()), {
      fitPass: true,
      missing: emptyFields(evidence),
      fetchesUsed: 4,
      hasNamedContact: true,
    });
    expect(result.verdict).toBe("HOLD");
    expect(result.rule_fired).toBe("R-22");
  });

  it("with a Hunter size of 201-500, the same company becomes a Send", () => {
    const evidence = fittingEvidence({ size_band: "201-500", size_band_evidence: hunterEvidence });
    const result = applyHandoffRules(computeVerdict(evidence, fired, weights(), switches()), {
      fitPass: true,
      missing: emptyFields(evidence),
      fetchesUsed: 4,
      hasNamedContact: true,
    });
    expect(emptyFields(evidence)).not.toContain("size_band");
    expect(result.verdict).toBe("SEND");
    expect(result.timing_score).toBe(55);
  });

  it("a Hunter size of 500+ drops the company under R-02, like a quoted one", () => {
    const evidence = fittingEvidence({ size_band: "500+", size_band_evidence: hunterEvidence });
    const result = computeVerdict(evidence, fired, weights(), switches());
    expect(result.verdict).toBe("DROP");
    expect(result.rule_fired).toBe("R-02");
  });
});
