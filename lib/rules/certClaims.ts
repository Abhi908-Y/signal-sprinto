import type { Evidence } from "@/lib/types";
import { sentences } from "@/lib/rules/signals";

/**
 * A second, page-wide reading of cert_status, run once after the loop.
 *
 * Extraction reads one page at a time and stops filling cert_status at the first answer, so a
 * security page that merely mentions security could set it to "none" while a press page read
 * later says "Stays SOC 2 Type 2 Compliant Two Years In A Row". That is how rocketlane.com was
 * pitched first-time certification despite two years of SOC 2. A certification claim on any page
 * we fetched outranks the absence of a badge on one of them, so this scan upgrades the field to
 * "certified" and quotes the sentence that proves it.
 *
 * Only SOC 2 and ISO 27001 count: they are what Sprinto certifies, and "GDPR compliant" or
 * "HIPAA compliant" are self-declared postures rather than audited certifications.
 */

const FRAMEWORK = String.raw`(?:soc\s*2|soc2|iso(?:\/iec)?\s*27001)`;

/** "SOC 2 Type II compliant", "ISO 27001 certified", "SOC 2 attestation report". */
const FRAMEWORK_THEN_STATUS = new RegExp(
  String.raw`\b${FRAMEWORK}\b[^.!?\n]{0,40}?\b(?:certified|compliant|attestation|audit report)\b`,
  "i",
);

/** "achieved SOC 2", "earns ISO 27001", "completed our SOC 2 Type II audit". */
const ACHIEVED_THEN_FRAMEWORK = new RegExp(
  String.raw`\b(?:achiev\w*|earn\w*|receiv\w*|complet\w*|obtain\w*|attain\w*|pass(?:ed|es)?)\b[^.!?\n]{0,40}?\b${FRAMEWORK}\b`,
  "i",
);

/** Not yet certified, or describing what they help customers do. */
const NOT_A_CLAIM =
  /\b(in progress|under ?way|coming soon|roadmap|pursuing|working to(?:wards?)?|currently undergoing|observation period|in the process|will be|plan(?:s|ning)? to|preparing|readiness|get certified|get (?:soc|iso)|become (?:soc|iso|compliant|certified)|help(?:s|ing)? (?:you|teams|companies|customers|businesses))\b/i;
const CUSTOMER_FACING = new RegExp(String.raw`\byour\b[^.!?\n]{0,30}${FRAMEWORK}`, "i");

export function isCertifiedClaim(sentence: string): boolean {
  if (NOT_A_CLAIM.test(sentence) || CUSTOMER_FACING.test(sentence)) return false;
  return FRAMEWORK_THEN_STATUS.test(sentence) || ACHIEVED_THEN_FRAMEWORK.test(sentence);
}

/** The first sentence, across every page fetched, that states the company is certified. */
export function findCertifiedClaim(pages: { url: string; text: string }[]): Evidence | null {
  for (const page of pages) {
    for (const sentence of sentences(page.text)) {
      if (isCertifiedClaim(sentence)) return { quote: sentence, url: page.url };
    }
  }
  return null;
}
