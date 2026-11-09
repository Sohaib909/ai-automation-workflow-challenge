/**
 * Reviewer notes on image ads often talk about the button ("remove the Learn More button"). The button is
 * drawn by the ad template, not the image model, so those requests are handled as a setting and taken out
 * of the note; whatever is left is passed to the image model.
 */
const BUTTON = String.raw`(?:the\s+)?(?:["“']?\s*[\w ]{0,20}?\s*["”']?\s*)?(?:button|btn|buton|cta|call[- ]to[- ]action)`;
const HIDE = new RegExp(String.raw`\b(?:remove|hide|delete|drop|take\s+(?:out|off|away)|get\s+rid\s+of|without|no)\b[^.;,]*?\b${BUTTON}\b[^.;,]*`, "i");
const SHOW = new RegExp(String.raw`\b(?:add|show|bring\s+back|put\s+back|keep)\b[^.;,]*?\b${BUTTON}\b[^.;,]*`, "i");
const LEARN_MORE_ONLY = /\b(?:remove|hide|delete|drop|without|no)\b[^.;,]*\blearn\s*more\b[^.;,]*/i;

export function parseButtonNote(note: string): { showCta?: boolean; rest: string } {
  let rest = note.trim();
  let showCta: boolean | undefined;
  for (const [re, value] of [
    [HIDE, false],
    [LEARN_MORE_ONLY, false],
    [SHOW, true],
  ] as const) {
    const m = re.exec(rest);
    if (m) {
      showCta ??= value;
      rest = (rest.slice(0, m.index) + rest.slice(m.index + m[0].length)).trim();
    }
  }
  // Tidy leftovers like "can u", "please", stray punctuation.
  const trim = (s: string) => s.replace(/^[\s,.;:!?-]+|[\s,;:-]+$/g, "").trim();
  rest = trim(trim(rest).replace(/^(?:(?:can|could)\s+(?:you|u)|please|pls|and|also|then)\b[\s,]*/gi, ""));
  if (!/[a-z]{3,}/i.test(rest) || /^(?:from\s+)?(?:this|the|it|that)?\s*(?:image|picture|ad|photo)?\s*[.!?]*$/i.test(rest) || isGenericNote(rest)) rest = "";
  return { showCta, rest };
}

/** "change the image", "try again", "new one" say nothing about the picture: just make a fresh variation. */
export function isGenericNote(note: string) {
  return /^(?:pl(?:ease|s)\s+)?(?:change|redo|regenerate|refresh|update|new|another|different|try\s+again|again|make\s+(?:a\s+)?new|give\s+me\s+(?:a\s+)?new)(?:\s+(?:the|this|a|an|it|that))?(?:\s+(?:image|picture|photo|one|version|visual|pic))?(?:\s+(?:please|pls|again))?[\s.!?]*$/i.test(note.trim());
}

/** Apply a reviewer note to the ORIGINAL prompt (keeps the prompt clean across many regenerations). */
export function promptWithNote(c: { image_prompt: string; base_prompt?: string }, note: string) {
  const base = c.base_prompt ?? c.image_prompt;
  return { base_prompt: base, image_prompt: note ? `${base.replace(/[.\s]+$/, "")}. ${note}`.slice(0, 1200) : c.image_prompt };
}
