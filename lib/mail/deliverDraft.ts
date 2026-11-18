import { sendEmail, type SendOutcome } from "@/lib/mail/send";
import * as q from "@/lib/db/queries";
import type { DraftRow } from "@/lib/db/queries";

/**
 * The one path from a stored draft to an email, shared by the Approve-and-send button
 * (`/api/send`) and by `auto_send` in the pipeline, so the two can never disagree about what
 * may be sent:
 *
 * - a draft whose hook quote failed validation is never sent (T-10);
 * - a draft that already went out is not sent twice;
 * - the recipient is not a parameter — `sendEmail` reads GMAIL_SEND_TO itself (§2.2).
 */

export type DeliveryResult =
  | { kind: "blocked"; blocked_reason: string | null }
  | { kind: "already_sent" }
  | { kind: "sent" | "failed"; outcome: SendOutcome };

export async function deliverDraft(draft: DraftRow): Promise<DeliveryResult> {
  if (!draft.validated) return { kind: "blocked", blocked_reason: draft.blocked_reason };

  const previous = await q.sendsFor(draft.id);
  if (previous.some((s) => s.status === "sent")) return { kind: "already_sent" };

  const outcome = await sendEmail({ subject: draft.subject, body: draft.body });

  await q.insertSend({
    draftId: draft.id,
    toAddress: outcome.to ?? "unknown",
    transport: outcome.ok ? outcome.transport : "none",
    status: outcome.ok ? "sent" : "failed",
    error: outcome.ok ? null : outcome.error,
  });

  return { kind: outcome.ok ? "sent" : "failed", outcome };
}
