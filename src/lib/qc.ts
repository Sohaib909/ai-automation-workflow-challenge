/**
 * Deterministic quality controls applied to every AI text output before a human sees it.
 * These don't replace human review — they direct the reviewer's attention to likely problems:
 * figures not supported by the brief, absolute claims, banned phrases, invented testimonials,
 * and platform length limits.
 */

export type FlagLevel = "error" | "warning" | "info";
export interface QCFlag {
  level: FlagLevel;
  code: string;
  field?: string;
  message: string;
}

const RISKY_PATTERNS: [RegExp, string][] = [
  [/\bguarantee(d|s)?\b/i, "guarantee"],
  [/\bproven\b/i, "proven"],
  [/\bclinically\b/i, "clinically"],
  [/\b(the\s+)?best\b/i, "best"],
  [/#\s?1\b|\bnumber one\b/i, "#1 / number one"],
  [/\bcures?\b/i, "cure"],
  [/\brisk[- ]free\b/i, "risk-free"],
  [/\bmiracle\b/i, "miracle"],
  [/\b100\s?%/i, "100%"],
  [/\bscientifically\b/i, "scientifically"],
];

const normalizeNumber = (s: string) => s.replace(/[,\s]/g, "").replace(/\.0+$/, "").toLowerCase();

/** Every figure (money, %, plain number ≥ 2 digits or with currency) in `text`. */
export function extractFigures(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/[£$€]\s?\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s?%|\b\d{2,}[\d,]*(?:\.\d+)?\b/g)) {
    out.add(m[0].trim());
  }
  return [...out];
}

export function checkClaims(
  text: string,
  ctx: { factSource: string; bannedClaims: string[] },
  field?: string,
): QCFlag[] {
  const flags: QCFlag[] = [];
  const source = ctx.factSource.toLowerCase().replace(/,/g, "");
  const sourceDigits = new Set((source.match(/\d+(?:\.\d+)?/g) ?? []).map(normalizeNumber));

  for (const fig of extractFigures(text)) {
    const digits = normalizeNumber(fig.replace(/[£$€%]/g, ""));
    if (!sourceDigits.has(digits)) {
      flags.push({
        level: "warning",
        code: "unsupported_figure",
        field,
        message: `Figure "${fig}" is not in the brief's offer or proof points — verify or remove.`,
      });
    }
  }
  for (const [re, label] of RISKY_PATTERNS) {
    if (re.test(text)) {
      flags.push({ level: "warning", code: "absolute_claim", field, message: `Absolute/unsupported claim language ("${label}") — needs substantiation.` });
    }
  }
  for (const banned of ctx.bannedClaims) {
    if (banned && text.toLowerCase().includes(banned.toLowerCase())) {
      flags.push({ level: "error", code: "banned_claim", field, message: `Uses banned phrase from brand guidelines: "${banned}".` });
    }
  }
  if (/["“][^"”]{8,}["”]\s*[—–-]\s*[A-Z][a-z]+/.test(text)) {
    flags.push({ level: "warning", code: "possible_testimonial", field, message: "Looks like a quoted testimonial — none were supplied in the brief." });
  }
  return flags;
}

/** Meta feed guidance (characters before truncation). Configurable per platform. */
export const PLATFORM_LIMITS: Record<string, { headline: number; primary_text: number; description: number; hook: number }> = {
  meta: { headline: 40, primary_text: 125, description: 30, hook: 90 },
};

export const ALLOWED_CTAS = [
  "Donate Now",
  "Learn More",
  "Sign Up",
  "Shop Now",
  "Get Offer",
  "Subscribe",
  "Apply Now",
  "Contact Us",
  "Get Started",
] as const;

export function checkLengths(fields: Record<string, string>, platform: string): QCFlag[] {
  const limits = PLATFORM_LIMITS[platform];
  if (!limits) return [{ level: "info", code: "no_limits", message: `No length limits configured for platform "${platform}".` }];
  const flags: QCFlag[] = [];
  for (const [key, max] of Object.entries(limits)) {
    const len = fields[key]?.length ?? 0;
    if (len > max) {
      flags.push({
        level: key === "primary_text" ? "info" : "warning",
        code: "length",
        field: key,
        message:
          key === "primary_text"
            ? `Primary text is ${len} chars; Meta truncates after ~${max} — make sure the first ${max} chars carry the message.`
            : `${key.replace("_", " ")} is ${len} chars (recommended ≤ ${max}).`,
      });
    }
  }
  return flags;
}

export function checkCta(cta: string): QCFlag[] {
  return (ALLOWED_CTAS as readonly string[]).includes(cta)
    ? []
    : [{ level: "error", code: "invalid_cta", field: "cta", message: `"${cta}" is not a supported Meta CTA button.` }];
}

export function worstLevel(flags: QCFlag[]): FlagLevel | "pass" {
  if (flags.some((f) => f.level === "error")) return "error";
  if (flags.some((f) => f.level === "warning")) return "warning";
  return flags.length ? "info" : "pass";
}

/** Token-set Jaccard similarity, used to catch near-duplicate ideas across batches. */
export function similarity(a: string, b: string): number {
  const tok = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 2 && !STOP.has(w)),
    );
  const A = tok(a);
  const B = tok(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}
const STOP = new Set(["the", "and", "for", "you", "your", "with", "this", "that", "are", "our", "from", "into", "what", "who", "when"]);
