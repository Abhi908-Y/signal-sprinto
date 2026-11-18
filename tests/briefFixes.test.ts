import { describe, it, expect, vi, beforeEach } from "vitest";
import { isCertifiedClaim, findCertifiedClaim } from "@/lib/rules/certClaims";
import { addressDraft, firstNameOf, SIGN_OFF } from "@/lib/pipeline/draftFormat";
import type { DraftRow, SendRow } from "@/lib/db/queries";

/* ------------------------------------------------ certified, from any page */

describe("certification claims across every page read", () => {
  it("recognises the claims rocketlane.com and zipy.ai actually make", () => {
    expect(
      isCertifiedClaim(
        "Rocketlane Fortifies Infosec: Gets SOC 1 Type 2 Certified, Stays SOC 2 Type 2 Compliant Two Years In A Row",
      ),
    ).toBe(true);
    expect(isCertifiedClaim("Zipy is GDPR and SOC2 Type II Compliant © 2026 Zipy Inc.")).toBe(true);
    expect(isCertifiedClaim("We are ISO 27001 certified and audited annually.")).toBe(true);
    expect(isCertifiedClaim("Acme has achieved SOC 2 Type II.")).toBe(true);
  });

  it("does not read plans, customer-facing copy or other frameworks as certification", () => {
    expect(isCertifiedClaim("We are currently working towards SOC 2 Type II.")).toBe(false);
    expect(isCertifiedClaim("SOC 2 certification is on our roadmap for 2027.")).toBe(false);
    expect(isCertifiedClaim("Get SOC 2 compliant in weeks, not months.")).toBe(false);
    expect(isCertifiedClaim("We help companies become SOC 2 compliant.")).toBe(false);
    expect(isCertifiedClaim("Pass your SOC 2 audit without the spreadsheets.")).toBe(false);
    expect(isCertifiedClaim("Rocketlane Achieves HIPAA Compliance for healthcare customers.")).toBe(false);
    expect(isCertifiedClaim("We take security seriously and encrypt all data.")).toBe(false);
  });

  it("finds the claim on a later page and quotes it with that page's URL", () => {
    const claim = findCertifiedClaim([
      { url: "https://acme.com/security", text: "We take security seriously. Data is encrypted at rest." },
      { url: "https://acme.com/news", text: "Big news today. Acme Stays SOC 2 Type 2 Compliant Two Years In A Row." },
    ]);
    expect(claim).toEqual({
      quote: "Acme Stays SOC 2 Type 2 Compliant Two Years In A Row.",
      url: "https://acme.com/news",
    });
  });

  it("returns nothing when no page claims a certification", () => {
    expect(findCertifiedClaim([{ url: "https://a.com/", text: "Project management for teams." }])).toBeNull();
  });
});

/* ------------------------------------------------------- addressed by name */

describe("draft addressed to the contact by name", () => {
  it("adds the greeting and sign-off a model left out", () => {
    const body = addressDraft("According to your press announcements, Rocketlane raised a Series C.", "Deepak");
    expect(body.startsWith("Hi Deepak,\n\n")).toBe(true);
    expect(body.endsWith(SIGN_OFF)).toBe(true);
  });

  it("corrects a greeting that names someone else", () => {
    expect(addressDraft("Hi there,\n\nRocketlane raised a Series C.", "Deepak")).toMatch(/^Hi Deepak,\n\nRocketlane/);
    expect(addressDraft("Dear Vignesh,\nRocketlane raised a Series C.", "Deepak")).toMatch(/^Hi Deepak,\n\nRocketlane/);
  });

  it("keeps a sign-off the model already wrote", () => {
    const body = addressDraft("Hi Deepak,\n\nOne line.\n\nBest,\nGrowth Lead, Sprinto", "Deepak");
    expect(body).toBe("Hi Deepak,\n\nOne line.\n\nBest,\nGrowth Lead, Sprinto");
  });

  it("never invents a name it does not have", () => {
    expect(firstNameOf(null)).toBeNull();
    expect(firstNameOf("not stated")).toBeNull();
    expect(firstNameOf("deepak")).toBe("Deepak");
    expect(addressDraft("One line.", null).startsWith("One line.")).toBe(true);
  });
});

/* --------------------------------------------- one send path, click or auto */

const sendsFor = vi.fn(async (_id: string): Promise<SendRow[]> => []);
const insertSend = vi.fn(async (_: unknown) => {});
const sendEmail = vi.fn(async (_: unknown) => ({
  ok: true as const,
  transport: "resend" as const,
  to: "locked@example.com",
  messageId: "m1",
  attempts: [],
}));

vi.mock("@/lib/db/queries", () => ({
  sendsFor: (id: string) => sendsFor(id),
  insertSend: (i: unknown) => insertSend(i),
}));
vi.mock("@/lib/mail/send", () => ({ sendEmail: (i: unknown) => sendEmail(i) }));

const draft = (patch: Partial<DraftRow> = {}): DraftRow => ({
  id: "dr_1",
  company_id: "co_1",
  subject: "s",
  body: "Hi Deepak,\n\nb",
  hook_quote: "q",
  hook_url: "https://a.com/",
  validated: true,
  blocked_reason: null,
  created_at: "2026-11-18",
  ...patch,
});

describe("deliverDraft — shared by the button and auto_send", () => {
  beforeEach(() => {
    sendsFor.mockClear();
    insertSend.mockClear();
    sendEmail.mockClear();
    sendsFor.mockResolvedValue([]);
  });

  it("sends a validated draft once and records it", async () => {
    const { deliverDraft } = await import("@/lib/mail/deliverDraft");
    const result = await deliverDraft(draft());
    expect(result.kind).toBe("sent");
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(insertSend).toHaveBeenCalledTimes(1);
  });

  it("never sends a draft that failed the evidence check", async () => {
    const { deliverDraft } = await import("@/lib/mail/deliverDraft");
    const result = await deliverDraft(draft({ validated: false, blocked_reason: "hook not on page" }));
    expect(result.kind).toBe("blocked");
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("does not send the same draft twice", async () => {
    sendsFor.mockResolvedValue([
      { id: "s1", draft_id: "dr_1", to_address: "x", transport: "resend", status: "sent", error: null, sent_at: "" },
    ]);
    const { deliverDraft } = await import("@/lib/mail/deliverDraft");
    const result = await deliverDraft(draft());
    expect(result.kind).toBe("already_sent");
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
