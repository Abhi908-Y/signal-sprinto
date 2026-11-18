/**
 * The brief asks for an email addressed to the contact by name. The prompt asks the model for a
 * greeting and a sign-off, but a model can drop either, so this pure step guarantees both: the
 * body always opens "Hi <first name>," and always ends with a Sprinto signature. A greeting
 * naming someone else is corrected rather than trusted.
 */

export const SIGN_OFF = "Best,\nGrowth Lead, Sprinto";

const GREETING_LINE = /^\s*(?:hi|hello|hey|dear)\b[^\n]*\n+/i;
const HAS_SIGN_OFF = /(?:best|regards|thanks|thank you|cheers|sincerely)[^\n]*\n[^\n]*sprinto[^\n]*\s*$/i;

/** A usable first name, or null when Hunter gave none we can trust. */
export function firstNameOf(firstName: string | null | undefined): string | null {
  const name = (firstName ?? "").trim();
  if (!name || name.toLowerCase() === "not stated") return null;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function addressDraft(body: string, firstName: string | null): string {
  let text = body.trim();

  if (firstName) {
    const greeting = `Hi ${firstName},`;
    text = GREETING_LINE.test(text)
      ? text.replace(GREETING_LINE, `${greeting}\n\n`)
      : `${greeting}\n\n${text}`;
  }

  if (!HAS_SIGN_OFF.test(text)) {
    // A model sign-off like "Best, Growth Lead, Sprinto" on one line is left alone; only a
    // missing one is added.
    if (!/sprinto\s*$/i.test(text)) text = `${text}\n\n${SIGN_OFF}`;
  }

  return text;
}
