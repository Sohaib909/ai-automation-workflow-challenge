import { z } from "zod";
import { type QCFlag, checkClaims } from "../qc";
import type { ProductionAgent } from "./registry";

/**
 * Specs for the five production agents. Each defines: options the user picks, what source it needs,
 * output schema, prompt, deterministic mock, and QC. All prompts share the same hard rules as ideas/copy:
 * only facts from the brief, no invented testimonials, respect banned claims.
 */

export interface AgentContext {
  client: { name: string; sector: string; brand_voice: string; brand_guidelines: string; banned_claims: string };
  campaign: { name: string; objective: string };
  brief: { product: string; audience: string; pain_points: string; offer: string; proof_points: string; tone: string; cta: string };
  idea: { title: string; lens: string; core_concept: string; hook: string; audience_insight: string; visual_direction: string; video_concept: string; copy_direction: string };
  copy?: { hook: string; headline: string; primary_text: string; description: string; cta: string };
  script?: ScriptOut;
  options: Record<string, string>;
}

const s = (max = 600) => z.string().trim().min(1).max(max);
const n = z.coerce.number();

/* ---------- Schemas ---------- */
export const ScriptSchema = z.object({
  title: s(120),
  hooks: z.array(s(200)).min(1).max(5),
  scenes: z
    .array(z.object({ duration_sec: n.min(1).max(60), visual: s(), voiceover: z.string().max(600), on_screen_text: z.string().max(200), broll: z.string().max(300) }))
    .min(2)
    .max(12),
  cta: s(200),
  production_notes: z.string().max(800),
});
export type ScriptOut = z.infer<typeof ScriptSchema>;

export const StaticSchema = z.object({
  concepts: z
    .array(z.object({ name: s(80), visual_concept: s(), composition: s(400), image_prompt: s(1200), negative_prompt: z.string().max(400), alt_text: s(250) }))
    .min(1)
    .max(4),
});
export type StaticConcept = z.infer<typeof StaticSchema>["concepts"][number] & {
  /** The AI's original image prompt; reviewer notes are applied to this, one at a time, never stacked. */
  base_prompt?: string;
  /** pending = a new image was asked for; the old one stays on screen until it arrives. */
  images?: { square: string | null; tall: string | null; provider: string; pending?: boolean };
};
/** show_cta: draw the call-to-action button on the ad image (default true). */
export type StaticOut = { concepts: StaticConcept[]; show_cta?: boolean };

export const UgcSchema = z.object({
  presenter_brief: s(800),
  setting: s(300),
  wardrobe: s(300),
  delivery_notes: s(500),
  shot_list: z.array(z.object({ shot: s(80), framing: s(120), action: s(300), line: z.string().max(400) })).min(2).max(15),
  b_roll: z.array(s(200)).max(10),
  disclosure: z.string().max(300),
  consent_note: z.string().max(300),
  job_spec: z.object({ aspect_ratio: s(10), duration_sec: n, voice: s(150), presenter_style: s(200), scenes: n }),
});
export type UgcOut = z.infer<typeof UgcSchema>;

export const EditSchema = z.object({
  total_duration_sec: n.min(1).max(180),
  timeline: z
    .array(z.object({ start_sec: n.min(0), end_sec: n.min(0), source: s(120), action: s(300), caption: z.string().max(200), broll: z.string().max(200) }))
    .min(2)
    .max(25),
  music: z.object({ mood: s(150), ducking: s(150) }),
  branding: z.object({ logo_placement: s(150), end_card: s(200) }),
  exports: z.array(z.object({ ratio: s(10), duration_sec: n, notes: z.string().max(200) })).min(1).max(6),
});
export type EditOut = z.infer<typeof EditSchema>;

export const LandingSchema = z.object({
  page_title: s(90),
  meta_description: s(200),
  sections: z
    .array(z.object({ type: s(30), heading: s(160), body: z.string().max(900), bullets: z.array(s(200)).max(6).default([]), cta_label: z.string().max(40).default("") }))
    .min(3)
    .max(9),
  faq: z.array(z.object({ q: s(200), a: s(600) })).max(6).default([]),
});
export type LandingOut = z.infer<typeof LandingSchema>;

/* ---------- Shared prompt pieces ---------- */
const RULES = `Hard rules:
- Use ONLY facts and figures from OFFER / PROOF POINTS. Never invent statistics, testimonials, quotes, reviews, awards or guarantees.
- Never use BANNED CLAIMS. Follow BRAND VOICE and GUIDELINES. British English.
- Reply with JSON only, matching the shape given.`;

function context(c: AgentContext) {
  return `CLIENT: ${c.client.name} (${c.client.sector})
BRAND VOICE: ${c.client.brand_voice}
GUIDELINES: ${c.client.brand_guidelines}
BANNED CLAIMS: ${c.client.banned_claims.split("\n").filter(Boolean).join("; ") || "(none)"}
CAMPAIGN: ${c.campaign.name} — ${c.campaign.objective}
PRODUCT / CAUSE: ${c.brief.product}
AUDIENCE: ${c.brief.audience}
PAIN POINTS: ${c.brief.pain_points}
OFFER: ${c.brief.offer}
PROOF POINTS (only usable facts):
${c.brief.proof_points || "(none — use no figures)"}
TONE: ${c.brief.tone} · CTA: ${c.brief.cta}

APPROVED IDEA: "${c.idea.title}" (${c.idea.lens})
Concept: ${c.idea.core_concept}
Hook: ${c.idea.hook}
Audience insight: ${c.idea.audience_insight}
Visual direction: ${c.idea.visual_direction}
Video concept: ${c.idea.video_concept}${
    c.copy
      ? `\n\nAPPROVED AD COPY:\nHook: ${c.copy.hook}\nHeadline: ${c.copy.headline}\nPrimary text: ${c.copy.primary_text}\nCTA button: ${c.copy.cta}`
      : ""
  }${c.script ? `\n\nAPPROVED SCRIPT:\n${JSON.stringify(c.script, null, 1)}` : ""}`;
}

const proof = (c: AgentContext) =>
  c.brief.proof_points
    .split("\n")
    .map((x) => x.replace(/\s*\(sample[^)]*\)/i, "").trim())
    .filter(Boolean);
const claimCtx = (c: AgentContext) => ({ factSource: `${c.brief.offer}\n${c.brief.proof_points}`, bannedClaims: c.client.banned_claims.split("\n").filter(Boolean) });

/* ---------- Specs ---------- */
export interface Spec<T> {
  schema: z.ZodType<T>;
  needs: "idea" | "idea_copy" | "script";
  options: { name: string; label: string; choices: string[]; default: string }[];
  system: string;
  prompt: (c: AgentContext) => string;
  mock: (c: AgentContext) => T;
  qc: (out: T, c: AgentContext) => QCFlag[];
}

const script: Spec<ScriptOut> = {
  schema: ScriptSchema,
  needs: "idea",
  options: [
    { name: "format", label: "Format", choices: ["UGC-style (creator to camera)", "Explainer", "Promo / brand"], default: "UGC-style (creator to camera)" },
    { name: "duration", label: "Length", choices: ["15", "30", "45", "60"], default: "30" },
    { name: "presenter", label: "Presenter", choices: ["Real creator", "Staff member", "AI presenter", "Voiceover only"], default: "Real creator" },
  ],
  system: `You are a senior short-form video scriptwriter at a paid-social agency. ${RULES}
"UGC-style" means a natural creator-to-camera delivery — it must NOT present invented personal stories or testimonials as real.`,
  prompt: (c) => `${context(c)}

Write a ${c.options.format} script, ${c.options.duration} seconds, presenter: ${c.options.presenter}, for Meta Reels/Stories (9:16).
Give 3 alternative opening hooks (first 2 seconds), then scenes whose durations add up to ${c.options.duration}s. Spoken words ≈ 2.5 per second.
End with the CTA.
JSON: {"title":"","hooks":["","",""],"scenes":[{"duration_sec":3,"visual":"","voiceover":"","on_screen_text":"","broll":""}],"cta":"","production_notes":""}`,
  mock: (c) => {
    const d = Number(c.options.duration) || 30;
    const p = proof(c);
    const per = Math.round(d / 4);
    return {
      title: `${c.idea.title} — ${d}s`,
      hooks: [c.idea.hook, p[0] ?? c.brief.offer, `What does ${c.brief.offer.split(",")[0]} really do?`].map((h) => h.slice(0, 200)),
      scenes: [
        { duration_sec: per, visual: "Presenter to camera, close-up", voiceover: c.idea.hook.slice(0, 120), on_screen_text: c.idea.title.slice(0, 60), broll: "" },
        { duration_sec: per, visual: "Illustrate the barrier", voiceover: `Maybe you think: ${(c.brief.pain_points.split(";")[0] ?? "").trim()}.`, on_screen_text: "", broll: "Everyday moment" },
        { duration_sec: per, visual: "Show the proof", voiceover: `${p[0] ?? c.brief.offer}.`, on_screen_text: p[0] ?? "", broll: c.idea.visual_direction.slice(0, 120) },
        { duration_sec: d - 3 * per, visual: "End card with logo", voiceover: `${c.brief.offer}. ${c.brief.cta}.`, on_screen_text: c.brief.cta, broll: "" },
      ],
      cta: c.brief.cta,
      production_notes: "Mock provider: template script, not AI-generated.",
    };
  },
  qc: (o, c) => {
    const flags: QCFlag[] = [];
    const target = Number(c.options.duration) || 30;
    const total = o.scenes.reduce((a, x) => a + x.duration_sec, 0);
    const words = o.scenes.map((x) => x.voiceover).join(" ").split(/\s+/).filter(Boolean).length;
    if (Math.abs(total - target) > target * 0.2) flags.push({ level: "warning", code: "duration", message: `Scenes add up to ${total}s; target is ${target}s.` });
    const wps = words / Math.max(total, 1);
    if (wps > 3) flags.push({ level: "warning", code: "pace", message: `${words} spoken words in ${total}s (${wps.toFixed(1)}/sec) — too fast to say naturally; aim for ≈2.5/sec.` });
    else flags.push({ level: "info", code: "pace", message: `${words} spoken words in ${total}s (${wps.toFixed(1)} words/sec).` });
    const last = o.scenes.at(-1)!;
    if (!`${last.voiceover} ${last.on_screen_text} ${o.cta}`.toLowerCase().includes(c.brief.cta.toLowerCase().split(" ")[0]))
      flags.push({ level: "warning", code: "cta", message: `Final scene doesn't clearly include the CTA ("${c.brief.cta}").` });
    for (const sc of o.scenes) flags.push(...checkClaims(`${sc.voiceover} ${sc.on_screen_text}`, claimCtx(c), "scene"));
    for (const h of o.hooks) flags.push(...checkClaims(h, claimCtx(c), "hook"));
    return dedupe(flags);
  },
};

const staticCreative: Spec<StaticOut> = {
  schema: StaticSchema,
  needs: "idea_copy",
  options: [{ name: "count", label: "Concepts", choices: ["1", "2", "3"], default: "2" }],
  system: `You are an art director for paid-social static ads. You design the VISUAL only: the headline, CTA and logo are added later by a brand template, so image prompts must never ask for text, words, letters or logos. ${RULES}`,
  prompt: (c) => `${context(c)}

Create ${c.options.count} distinct static ad visual concepts for Meta feed (1:1, 4:5) and Stories (9:16). Leave clear space in the top third for the headline.
For each: name, visual_concept, composition (where subject/space sit), image_prompt, negative_prompt, alt_text.
image_prompt: 40–90 words describing ONLY what is in the photo: subject, action, setting, lighting, camera/lens, mood. The image model draws every word it reads, so never mention text, logos, watermarks, UI or anything to avoid there. Put all exclusions in negative_prompt instead.
JSON: {"concepts":[{"name":"","visual_concept":"","composition":"","image_prompt":"","negative_prompt":"","alt_text":""}]}`,
  mock: (c) => ({
    concepts: Array.from({ length: Number(c.options.count) || 2 }, (_, i) => ({
      name: i ? "Quiet detail" : "Hero moment",
      visual_concept: `${c.idea.visual_direction} (${i ? "close-up detail" : "wide scene"}).`,
      composition: "Subject in lower two-thirds; clean space top third for headline; CTA bottom right.",
      image_prompt: `Photograph, natural light, ${c.idea.visual_direction}, ${i ? "close-up" : "wide shot"}, authentic, warm tones, no text`,
      negative_prompt: "text, words, letters, logo, watermark, distorted hands",
      alt_text: c.idea.title,
    })),
  }),
  qc: (o, c) => {
    const flags: QCFlag[] = [];
    for (const k of o.concepts) {
      // Ignore negated mentions ("no people, text or logos", "without any text") — those are what we want.
      const positive = k.image_prompt.replace(/\b(no|without|free of|avoid(?:ing)?|exclude)\b[^.;]*/gi, "");
      if (/\b(text|words?|letters?|logos?|typography|captions?)\b/i.test(positive))
        flags.push({ level: "warning", code: "prompt_text", message: `"${k.name}": image prompt asks the model to draw text/logo — these come from the template.` });
      flags.push(...checkClaims(`${k.visual_concept} ${k.alt_text}`, claimCtx(c), "concept"));
    }
    if (c.copy && c.copy.headline.length > 40) flags.push({ level: "warning", code: "overlay", message: `Headline is ${c.copy.headline.length} chars — long for an image overlay (≤40 recommended).` });
    return dedupe(flags);
  },
};

const ugc: Spec<UgcOut> = {
  schema: UgcSchema,
  needs: "script",
  options: [{ name: "route", label: "Production route", choices: ["Real creator", "AI presenter (avatar)"], default: "Real creator" }],
  system: `You are a UGC video producer at a paid-social agency. You turn an approved script into a production pack. ${RULES}
If the route is an AI presenter, include a clear AI disclosure line; any presenter likeness must be licensed or consented.`,
  prompt: (c) => `${context(c)}

Production route: ${c.options.route}. Build the production pack: presenter brief (who, energy, how to deliver), setting, wardrobe, delivery notes,
shot list (one row per shot: shot name, framing, action, line from the script), B-roll list, disclosure line, consent note, and a render job spec.
JSON: {"presenter_brief":"","setting":"","wardrobe":"","delivery_notes":"","shot_list":[{"shot":"","framing":"","action":"","line":""}],"b_roll":[""],"disclosure":"","consent_note":"","job_spec":{"aspect_ratio":"9:16","duration_sec":30,"voice":"","presenter_style":"","scenes":4}}`,
  mock: (c) => {
    const sc = c.script!;
    const ai = c.options.route.startsWith("AI");
    return {
      presenter_brief: `${ai ? "Licensed AI presenter" : "Creator"} aged 30–50, warm and direct, speaking as a supporter (not a beneficiary).`,
      setting: "Home kitchen, morning light",
      wardrobe: "Casual knitwear, muted colours, no logos",
      delivery_notes: "Conversational, one take per scene, pause before the CTA.",
      shot_list: sc.scenes.map((x, i) => ({ shot: `Scene ${i + 1}`, framing: i === 0 ? "Close-up" : "Medium", action: x.visual, line: x.voiceover })),
      b_roll: sc.scenes.map((x) => x.broll).filter(Boolean),
      disclosure: ai ? "Made with an AI-generated presenter." : "",
      consent_note: ai ? "Use a provider avatar licensed for commercial use." : "Creator signs usage-rights release before filming.",
      job_spec: { aspect_ratio: "9:16", duration_sec: sc.scenes.reduce((a, x) => a + x.duration_sec, 0), voice: "Warm British female", presenter_style: ai ? "Stock licensed avatar" : "n/a — real creator", scenes: sc.scenes.length },
    };
  },
  qc: (o, c) => {
    const flags: QCFlag[] = [];
    if (c.options.route.startsWith("AI") && !o.disclosure.trim()) flags.push({ level: "error", code: "disclosure", message: "AI presenter route needs an AI disclosure line." });
    if (!o.consent_note.trim()) flags.push({ level: "warning", code: "consent", message: "No consent / usage-rights note." });
    for (const s of o.shot_list) flags.push(...checkClaims(s.line, claimCtx(c), "line"));
    flags.push({ level: "info", code: "not_submitted", message: "Render job not submitted — no video provider is connected in this prototype." });
    return dedupe(flags);
  },
};

const edit: Spec<EditOut> = {
  schema: EditSchema,
  needs: "script",
  options: [{ name: "style", label: "Editing style", choices: ["Native / UGC (fast cuts, bold captions)", "Polished brand", "Documentary"], default: "Native / UGC (fast cuts, bold captions)" }],
  system: `You are a senior short-form video editor. You produce an edit decision list from an approved script for an editor or render service to execute. ${RULES}`,
  prompt: (c) => `${context(c)}

Editing style: ${c.options.style}. Produce the edit plan: a timeline (start/end seconds, source clip, action e.g. cut/jump-cut/zoom, burned-in caption text for every spoken line, B-roll cue),
music (mood + ducking under voice), branding (logo placement, end card), and export versions (9:16, 4:5, 1:1 and a 6–15s cut-down).
JSON: {"total_duration_sec":30,"timeline":[{"start_sec":0,"end_sec":3,"source":"","action":"","caption":"","broll":""}],"music":{"mood":"","ducking":""},"branding":{"logo_placement":"","end_card":""},"exports":[{"ratio":"9:16","duration_sec":30,"notes":""}]}`,
  mock: (c) => {
    let t = 0;
    const timeline = c.script!.scenes.map((x, i) => {
      const seg = { start_sec: t, end_sec: t + x.duration_sec, source: `Take: scene ${i + 1}`, action: i ? "Jump cut, trim pauses" : "Open on face, punch-in", caption: x.voiceover.slice(0, 200), broll: x.broll };
      t += x.duration_sec;
      return seg;
    });
    return {
      total_duration_sec: t,
      timeline,
      music: { mood: "Warm, hopeful acoustic", ducking: "-12 dB under voice" },
      branding: { logo_placement: "Top right from 2s, 60% opacity", end_card: `${c.client.name} logo + "${c.brief.cta}"` },
      exports: [
        { ratio: "9:16", duration_sec: t, notes: "Reels / Stories" },
        { ratio: "4:5", duration_sec: t, notes: "Feed" },
        { ratio: "1:1", duration_sec: Math.min(15, t), notes: "Cut-down" },
      ],
    };
  },
  qc: (o) => {
    const flags: QCFlag[] = [];
    const end = Math.max(...o.timeline.map((x) => x.end_sec));
    if (Math.abs(end - o.total_duration_sec) > 1) flags.push({ level: "warning", code: "timeline", message: `Timeline ends at ${end}s but total is ${o.total_duration_sec}s.` });
    const missing = o.timeline.filter((x) => !x.caption.trim()).length;
    if (missing) flags.push({ level: "info", code: "captions", message: `${missing} segment(s) have no caption — fine for B-roll only, check spoken lines.` });
    if (!o.exports.some((x) => x.ratio.replace(/\s/g, "") === "9:16")) flags.push({ level: "warning", code: "exports", message: "No 9:16 export for Reels/Stories." });
    flags.push({ level: "info", code: "not_rendered", message: "Plan only — no render service is connected in this prototype." });
    return flags;
  },
};

const landing: Spec<LandingOut> = {
  schema: LandingSchema,
  needs: "idea_copy",
  options: [{ name: "length", label: "Page length", choices: ["Short (5 sections)", "Standard (7 sections)"], default: "Short (5 sections)" }],
  system: `You are a conversion copywriter and UX writer building campaign landing pages that match the ad people clicked. ${RULES}
Never include a testimonials/reviews section unless real testimonials are supplied (none are).`,
  prompt: (c) => `${context(c)}

Build a ${c.options.length} landing page. Section types to choose from: hero, problem, solution, how_it_works, impact, offer, faq, cta.
The hero must echo the ad's hook/headline. Every section that asks for action uses the CTA "${c.brief.cta}". Include 3–4 FAQs answering real objections (from PAIN POINTS).
JSON: {"page_title":"","meta_description":"","sections":[{"type":"hero","heading":"","body":"","bullets":[],"cta_label":""}],"faq":[{"q":"","a":""}]}`,
  mock: (c) => {
    const p = proof(c);
    return {
      page_title: `${c.client.name} — ${c.campaign.name}`,
      meta_description: `${c.brief.offer}. ${p[0] ?? ""}`.slice(0, 200),
      sections: [
        { type: "hero", heading: c.copy?.headline ?? c.idea.hook, body: c.idea.core_concept.split(".")[0] + ".", bullets: [], cta_label: c.brief.cta },
        { type: "problem", heading: "Why it matters", body: c.brief.pain_points.split(";")[0] ?? "", bullets: [], cta_label: "" },
        { type: "impact", heading: "What your support does", body: "", bullets: p.slice(0, 3), cta_label: "" },
        { type: "offer", heading: c.brief.offer, body: "Simple to start, easy to change.", bullets: [], cta_label: c.brief.cta },
        { type: "cta", heading: "Ready?", body: "", bullets: [], cta_label: c.brief.cta },
      ],
      faq: [{ q: "Can I cancel?", a: c.brief.offer.toLowerCase().includes("cancel") ? "Yes — anytime." : "Contact us any time." }],
    };
  },
  qc: (o, c) => {
    const flags: QCFlag[] = [];
    const types = o.sections.map((x) => x.type.toLowerCase());
    if (!types.includes("hero")) flags.push({ level: "warning", code: "hero", message: "No hero section." });
    if (!o.sections.some((x) => x.cta_label)) flags.push({ level: "error", code: "cta", message: "No call-to-action anywhere on the page." });
    if (types.some((t) => /testimonial|review/.test(t))) flags.push({ level: "error", code: "testimonials", message: "Testimonials section included but none were supplied." });
    for (const x of o.sections) flags.push(...checkClaims(`${x.heading} ${x.body} ${x.bullets.join(" ")}`, claimCtx(c), x.type));
    for (const f of o.faq) flags.push(...checkClaims(f.a, claimCtx(c), "faq"));
    if (o.meta_description.length > 160) flags.push({ level: "info", code: "meta", message: `Meta description is ${o.meta_description.length} chars (Google shows ~155).` });
    return dedupe(flags);
  },
};

function dedupe(flags: QCFlag[]) {
  const seen = new Set<string>();
  return flags.filter((f) => {
    const k = `${f.level}|${f.code}|${f.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const SPECS: Record<ProductionAgent, Spec<any>> = { script, static: staticCreative, ugc, edit, landing };
