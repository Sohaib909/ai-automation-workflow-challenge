import { z } from "zod";
import { ALLOWED_CTAS, type QCFlag, checkClaims, checkCta, checkLengths } from "../qc";
import type { IdeaContext } from "../ideas/logic";

export const COPY_FIELDS = ["hook", "headline", "primary_text", "description", "cta"] as const;
export type CopyField = (typeof COPY_FIELDS)[number];

export const CopyVariationSchema = z.object({
  angle: z.string().min(2).max(80),
  hook: z.string().min(3).max(200),
  headline: z.string().min(2).max(120),
  primary_text: z.string().min(10).max(1200),
  description: z.string().min(2).max(120),
  cta: z.string().min(2).max(40),
});
export const CopyBatchSchema = z.object({ variations: z.array(CopyVariationSchema).min(1).max(6) });
export type CopyVariation = z.infer<typeof CopyVariationSchema>;

export const FieldRegenSchema = z.object({ value: z.string().min(2).max(1200) });

export interface ApprovedIdea {
  title: string;
  lens: string;
  core_concept: string;
  hook: string;
  copy_direction: string;
  audience_insight: string;
}

export const COPY_SYSTEM = `You are a senior direct-response copywriter at a paid-social and fundraising agency.
Write Meta ad copy that is specific, human and on-brand.
Hard rules:
- Use ONLY facts and figures in OFFER / PROOF POINTS. No invented statistics, testimonials, quotes, awards or guarantees.
- Never use BANNED CLAIMS. Follow BRAND VOICE and GUIDELINES.
- Limits: hook ≤ 90 chars, headline ≤ 40, description ≤ 30. Primary text: the first 125 chars must carry the message.
- CTA must be exactly one of: ${ALLOWED_CTAS.join(", ")}.
- Each variation takes a clearly different angle on the approved idea.
- Reply with JSON only.`;

function contextBlock(ctx: Omit<IdeaContext, "previous" | "learnings" | "count">, idea: ApprovedIdea) {
  return `CLIENT: ${ctx.client.name} (${ctx.client.sector})
BRAND VOICE: ${ctx.client.brand_voice}
GUIDELINES: ${ctx.client.brand_guidelines}
BANNED CLAIMS: ${ctx.client.banned_claims.split("\n").filter(Boolean).join("; ") || "(none)"}
CAMPAIGN: ${ctx.campaign.name} — ${ctx.campaign.objective}
PRODUCT / CAUSE: ${ctx.brief.product}
AUDIENCE: ${ctx.brief.audience}
PAIN POINTS: ${ctx.brief.pain_points}
OFFER: ${ctx.brief.offer}
PROOF POINTS (only usable facts):
${ctx.brief.proof_points || "(none — use no figures)"}
TONE: ${ctx.brief.tone}
PREFERRED CTA: ${ctx.brief.cta}

APPROVED IDEA: "${idea.title}" (${idea.lens})
Concept: ${idea.core_concept}
Audience insight: ${idea.audience_insight}
Idea hook: ${idea.hook}
Copy direction: ${idea.copy_direction}`;
}

export function buildCopyPrompt(ctx: Omit<IdeaContext, "previous" | "learnings" | "count">, idea: ApprovedIdea, count: number) {
  return `${contextBlock(ctx, idea)}

Write ${count} Meta feed ad variations for this idea.
JSON shape: {"variations":[{"angle":"<short label>","hook":"","headline":"","primary_text":"","description":"","cta":""}]}`;
}

export function buildFieldPrompt(
  ctx: Omit<IdeaContext, "previous" | "learnings" | "count">,
  idea: ApprovedIdea,
  current: CopyVariation,
  field: CopyField,
  instruction: string,
) {
  return `${contextBlock(ctx, idea)}

CURRENT VARIATION:
${JSON.stringify(current, null, 2)}

Rewrite ONLY the "${field}" field so it works with the rest of the variation.${instruction ? ` Reviewer instruction: ${instruction}` : ""}
JSON shape: {"value":"<new ${field}>"}`;
}

export function runCopyQC(v: CopyVariation, ctx: { factSource: string; bannedClaims: string[]; platform: string }): QCFlag[] {
  const claimCtx = { factSource: ctx.factSource, bannedClaims: ctx.bannedClaims };
  return [
    ...checkClaims(v.hook, claimCtx, "hook"),
    ...checkClaims(v.headline, claimCtx, "headline"),
    ...checkClaims(v.primary_text, claimCtx, "primary_text"),
    ...checkClaims(v.description, claimCtx, "description"),
    ...checkLengths(v, ctx.platform),
    ...checkCta(v.cta),
  ];
}

const ANGLES = ["Lead with the proof", "Answer the objection", "Make it personal"];

export function mockCopy(ctx: Omit<IdeaContext, "previous" | "learnings" | "count">, idea: ApprovedIdea, count: number): { variations: CopyVariation[] } {
  const proofs = ctx.brief.proof_points.split("\n").map((s) => s.replace(/\s*\(sample[^)]*\)/i, "").trim()).filter(Boolean);
  const pains = ctx.brief.pain_points.split(/[;\n]/).map((s) => s.trim()).filter(Boolean);
  const cta = (ALLOWED_CTAS as readonly string[]).includes(ctx.brief.cta) ? ctx.brief.cta : "Learn More";
  return {
    variations: Array.from({ length: count }, (_, i) => {
      const proof = proofs[i % Math.max(1, proofs.length)] ?? ctx.brief.offer;
      const pain = pains[i % Math.max(1, pains.length)] ?? "";
      return {
        angle: ANGLES[i % ANGLES.length],
        hook: (i === 1 && pain ? `${pain.charAt(0).toUpperCase()}${pain.slice(1)}? Here's the truth.` : proof).slice(0, 90),
        headline: ctx.brief.offer.split(",")[0].slice(0, 40),
        primary_text: `${idea.hook}\n\n${proof}. ${ctx.brief.offer}.\n\n${idea.core_concept.split(".")[0]}.`,
        description: ctx.campaign.name.slice(0, 30),
        cta,
      };
    }),
  };
}

export function mockField(current: CopyVariation, field: CopyField): { value: string } {
  const v = current[field];
  if (field === "cta") return { value: v === "Learn More" ? "Sign Up" : "Learn More" };
  return { value: field === "headline" || field === "description" ? v.split(" ").reverse().join(" ") : `${v} (alt)` };
}
