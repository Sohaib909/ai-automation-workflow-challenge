import { z } from "zod";

/**
 * Pure logic for the Idea Generator (no DB / network) — prompt construction, output schema,
 * explainable scoring, and the mock builder.
 */

/** Creative lenses force genuinely different angles instead of 5 rewrites of one idea. */
export const LENSES = [
  { key: "tangible_impact", name: "Tangible impact", hint: "Make the outcome concrete and visible — what exactly changes, for whom, tonight." },
  { key: "myth_buster", name: "Myth-buster", hint: "Name a belief the audience holds that stops them acting, then flip it." },
  { key: "first_person", name: "First-person POV", hint: "Tell it through one specific person's eyes (beneficiary, staff, customer) — no invented quotes." },
  { key: "ritual", name: "Everyday ritual", hint: "Attach the offer to a small daily habit the audience already has." },
  { key: "contrast", name: "Before / after contrast", hint: "Show two states side by side; the offer is the bridge." },
  { key: "behind_scenes", name: "Behind the scenes", hint: "Reveal how it actually works, to answer distrust with transparency." },
  { key: "identity", name: "Identity & belonging", hint: "Invite the audience into a group they'd be proud to belong to." },
  { key: "moment", name: "Seasonal / cultural moment", hint: "Anchor to a moment in the calendar or culture the audience is living through now." },
] as const;

export const CRITERIA = {
  audience_relevance: { label: "Audience relevance", weight: 0.18 },
  originality: { label: "Originality", weight: 0.16 },
  brand_fit: { label: "Brand fit", weight: 0.14 },
  clarity: { label: "Clarity", weight: 0.12 },
  emotional_appeal: { label: "Emotional appeal", weight: 0.12 },
  feasibility: { label: "Feasibility", weight: 0.1 },
  objective_alignment: { label: "Objective alignment", weight: 0.1 },
  testability: { label: "Testability", weight: 0.08 },
} as const;
export type Criterion = keyof typeof CRITERIA;

const score = z.object({ score: z.number().int().min(1).max(5), reason: z.string().min(3).max(240) });

export const IdeaSchema = z.object({
  title: z.string().min(3).max(80),
  lens: z.string().min(2),
  core_concept: z.string().min(20).max(600),
  audience_insight: z.string().min(10).max(400),
  hook: z.string().min(5).max(160),
  visual_direction: z.string().min(10).max(400),
  copy_direction: z.string().min(10).max(400),
  video_concept: z.string().min(10).max(400),
  test_hypothesis: z.string().min(10).max(300),
  rationale: z.string().min(10).max(500),
  scores: z.object(Object.fromEntries(Object.keys(CRITERIA).map((k) => [k, score])) as Record<Criterion, typeof score>),
});
export const IdeaBatchSchema = z.object({ ideas: z.array(IdeaSchema).min(1).max(8) });
export type IdeaOut = z.infer<typeof IdeaSchema>;
export type IdeaScores = IdeaOut["scores"];

/** Weighted 0–100. A review aid that explains itself — explicitly not a performance prediction. */
export function totalScore(scores: IdeaScores): number {
  let t = 0;
  for (const [k, { weight }] of Object.entries(CRITERIA)) t += ((scores[k as Criterion].score - 1) / 4) * weight;
  return Math.round(t * 100);
}

export interface IdeaContext {
  client: { name: string; sector: string; brand_voice: string; brand_guidelines: string; banned_claims: string };
  campaign: { name: string; objective: string; platform: string };
  brief: { product: string; audience: string; pain_points: string; offer: string; proof_points: string; tone: string; cta: string };
  previous: { title: string; hook: string; status: string; rating: number | null }[];
  learnings: string[];
  direction?: string;
  count: number;
}

export function pickLenses(count: number, previousLenses: string[]): (typeof LENSES)[number][] {
  // Prefer lenses not used yet for this campaign, then wrap around.
  const unused = LENSES.filter((l) => !previousLenses.includes(l.name));
  const ordered = [...unused, ...LENSES.filter((l) => previousLenses.includes(l.name))];
  return ordered.slice(0, count);
}

export const IDEA_SYSTEM = `You are the head of creative strategy at a performance advertising and fundraising agency.
You generate campaign ideas that are specific, surprising and testable — not generic marketing filler.
Hard rules:
- Use ONLY facts and figures given in PROOF POINTS / OFFER. Never invent statistics, testimonials, endorsements, awards or outcomes.
- Respect BRAND VOICE, GUIDELINES and never use BANNED CLAIMS.
- Each idea must use the creative lens assigned to it, and ideas must be clearly different from each other and from PREVIOUS IDEAS.
- Score each idea honestly 1–5 on every criterion with a one-sentence reason. Scores are for reviewer triage, not predictions.
- Reply with JSON only.`;

export function buildIdeaPrompt(ctx: IdeaContext, lenses: (typeof LENSES)[number][]): string {
  const prev = ctx.previous.length
    ? ctx.previous
        .map((p) => `- "${p.title}" — hook: "${p.hook}" [${p.status}${p.rating ? `, rated ${p.rating}/5` : ""}]`)
        .join("\n")
    : "(none)";
  return `CLIENT: ${ctx.client.name} (${ctx.client.sector})
BRAND VOICE: ${ctx.client.brand_voice}
BRAND GUIDELINES: ${ctx.client.brand_guidelines}
BANNED CLAIMS: ${ctx.client.banned_claims.split("\n").filter(Boolean).join("; ") || "(none)"}

CAMPAIGN: ${ctx.campaign.name} — objective: ${ctx.campaign.objective} — platform: ${ctx.campaign.platform}
PRODUCT / CAUSE: ${ctx.brief.product}
AUDIENCE: ${ctx.brief.audience}
PAIN POINTS / BARRIERS: ${ctx.brief.pain_points}
OFFER: ${ctx.brief.offer}
PROOF POINTS (only usable facts):
${ctx.brief.proof_points || "(none — do not use any figures)"}
TONE: ${ctx.brief.tone}
PRIMARY CTA: ${ctx.brief.cta}

PERFORMANCE LEARNINGS FROM LIVE ADS (use to inform ideas; cite them in rationale when used):
${ctx.learnings.length ? ctx.learnings.map((l) => `- ${l}`).join("\n") : "(no performance data yet)"}

PREVIOUS IDEAS (do not repeat; lean towards what reviewers approved/rated highly, away from rejected):
${prev}
${ctx.direction ? `\nREVIEWER DIRECTION FOR THIS BATCH: ${ctx.direction}\n` : ""}
Generate exactly ${lenses.length} ideas, one per lens:
${lenses.map((l, i) => `${i + 1}. ${l.name} — ${l.hint}`).join("\n")}

JSON shape:
{"ideas":[{"title":"","lens":"<lens name>","core_concept":"","audience_insight":"","hook":"<first line / first 2 seconds>","visual_direction":"","copy_direction":"","video_concept":"","test_hypothesis":"If we ..., then ... because ...","rationale":"","scores":{${Object.keys(CRITERIA)
    .map((k) => `"${k}":{"score":1-5,"reason":""}`)
    .join(",")}}}]}`;
}

/** Deterministic mock — template-built from the brief, clearly labelled in the UI as non-AI. */
export function mockIdeas(ctx: IdeaContext, lenses: (typeof LENSES)[number][]): { ideas: IdeaOut[] } {
  const proof = ctx.brief.proof_points.split("\n").map((s) => s.replace(/\s*\(sample[^)]*\)/i, "").trim()).filter(Boolean);
  const pain = ctx.brief.pain_points.split(/[;\n]/).map((s) => s.trim()).filter(Boolean);
  const fact = (i: number) => proof[i % Math.max(proof.length, 1)] ?? ctx.brief.offer;
  const barrier = (i: number) => pain[i % Math.max(pain.length, 1)] ?? "not sure it makes a difference";
  const learning = ctx.learnings[0];

  return {
    ideas: lenses.map((l, i) => {
      const s = (base: number, k: number) => Math.min(5, Math.max(2, base + ((i + k) % 3) - 1));
      const mk = (n: number, why: string) => ({ score: n, reason: why });
      return {
        title: `${l.name}: ${ctx.brief.product.split(/[,(]/)[0].trim()}`.slice(0, 80),
        lens: l.name,
        core_concept: `${l.hint} Applied to ${ctx.brief.product.toLowerCase()} for ${ctx.brief.audience.toLowerCase()}, built around: "${fact(i)}".`,
        audience_insight: `The audience's barrier: "${barrier(i)}". This idea answers it directly.`,
        hook: `${l.key === "myth_buster" ? `Think "${barrier(i).toLowerCase()}"?` : fact(i)} — ${ctx.brief.offer}.`.slice(0, 160),
        visual_direction: `${l.name} framing; ${ctx.client.brand_guidelines.split(".")[0]}.`,
        copy_direction: `Lead with the ${l.name.toLowerCase()} angle in a ${ctx.brief.tone.toLowerCase()} voice; close on "${ctx.brief.cta}".`,
        video_concept: `15–20s vertical: open on the hook, one scene illustrating "${fact(i)}", end card with ${ctx.brief.cta}.`,
        test_hypothesis: `If we lead with the ${l.name.toLowerCase()} angle, then click-through improves because it addresses "${barrier(i)}".`,
        rationale: learning && i === 0 ? `Informed by performance learning: ${learning}` : `Lens chosen to cover a distinct angle (${l.name}).`,
        scores: {
          audience_relevance: mk(s(4, 0), "Directly addresses a stated audience barrier."),
          originality: mk(s(3, 1), "Template-based mock — originality not assessed by AI."),
          brand_fit: mk(s(4, 2), "Uses brief tone and guidelines."),
          clarity: mk(s(4, 0), "Single message built on one proof point."),
          emotional_appeal: mk(s(3, 1), "Depends on execution."),
          feasibility: mk(s(4, 2), "Producible with existing assets."),
          objective_alignment: mk(s(4, 0), `Ends on the campaign CTA (${ctx.brief.cta}).`),
          testability: mk(s(4, 1), "Clear single-variable hypothesis."),
        },
      };
    }),
  };
}
