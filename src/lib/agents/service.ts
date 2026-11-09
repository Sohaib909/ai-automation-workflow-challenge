import "server-only";
import { getDb, now } from "../db";
import { audit, recordApproval } from "../audit";
import { generateStructured } from "../ai/generate";
import type { QCFlag } from "../qc";
import { USABLE, WorkflowError, getCampaign, getClient, getIdea, type BriefRow, type CopyRow, type Decision } from "../creative/service";
import { type AgentContext, SPECS, type ScriptOut, type StaticOut } from "./specs";
import { ImageRateLimit, canGenerateInParallel, generateAdImage, imageProvider } from "../images";
import { type ProductionAgent, agentBySlug } from "./registry";
import { isGenericNote, parseButtonNote, promptWithNote } from "./static-notes";
import { z } from "zod";

export interface AgentOutputRow {
  id: number;
  agent: ProductionAgent;
  campaign_id: number;
  idea_id: number;
  source_output_id: number | null;
  source_copy_id: number | null;
  options_json: string;
  content_json: string;
  qc_json: string;
  status: string;
  provider: string;
  model: string;
  created_at: string;
}

const db = () => getDb();

export function getOutput(id: number) {
  return db().prepare("SELECT * FROM agent_outputs WHERE id = ?").get(id) as AgentOutputRow | undefined;
}

export function listOutputs(agent: ProductionAgent, campaignId: number) {
  return db().prepare("SELECT * FROM agent_outputs WHERE agent = ? AND campaign_id = ? AND status != 'archived' ORDER BY id DESC").all(agent, campaignId) as unknown as AgentOutputRow[];
}

export function approvedScripts(campaignId: number) {
  return db()
    .prepare("SELECT o.*, i.title AS idea_title FROM agent_outputs o JOIN ideas i ON i.id = o.idea_id WHERE o.agent = 'script' AND o.campaign_id = ? AND o.status IN ('approved','ai_selected') ORDER BY o.id DESC")
    .all(campaignId) as unknown as (AgentOutputRow & { idea_title: string })[];
}

export function approvedCopy(campaignId: number) {
  return db()
    .prepare("SELECT * FROM copy_variations WHERE campaign_id = ? AND is_current = 1 AND status IN ('approved','ai_selected') ORDER BY id DESC")
    .all(campaignId) as unknown as CopyRow[];
}

export function countsByAgent(campaignId: number) {
  const rows = db()
    .prepare("SELECT agent, COUNT(*) n, SUM(status = 'approved') approved FROM agent_outputs WHERE campaign_id = ? GROUP BY agent")
    .all(campaignId) as { agent: string; n: number; approved: number }[];
  return Object.fromEntries(rows.map((r) => [r.agent, { n: r.n, approved: r.approved }])) as Record<string, { n: number; approved: number }>;
}

/**
 * Generate an output for a production agent. Enforces the workflow gates:
 * - every agent needs a human-approved idea
 * - static creative and landing pages need approved copy
 * - UGC and video editing need an approved script
 */
export async function generateAgentOutput(
  agent: ProductionAgent,
  input: { ideaId?: number; copyId?: number; scriptId?: number; options: Record<string, string>; instruction?: string; previous?: string },
) {
  const spec = SPECS[agent];
  const name = agentBySlug(agent)!.name;

  let ideaId = input.ideaId;
  let script: ScriptOut | undefined;
  let scriptRow: AgentOutputRow | undefined;
  if (spec.needs === "script") {
    scriptRow = input.scriptId ? getOutput(input.scriptId) : undefined;
    if (!scriptRow || scriptRow.agent !== "script") throw new WorkflowError("Choose an approved script first.");
    if (!USABLE.includes(scriptRow.status)) throw new WorkflowError("That script isn't approved yet. Approve it in Script Writing first.");
    script = JSON.parse(scriptRow.content_json) as ScriptOut;
    ideaId = scriptRow.idea_id;
  }

  const idea = ideaId ? getIdea(ideaId) : undefined;
  if (!idea) throw new WorkflowError("Choose an approved idea first.");
  if (idea.status === "archived") throw new WorkflowError("This was built from an idea you've since replaced. Click “Run the AI again” to rebuild from the new idea.");
  if (!USABLE.includes(idea.status)) throw new WorkflowError("That idea isn't approved yet. Approve it in the AI Idea Generator first.");
  const campaign = getCampaign(idea.campaign_id)!;
  const client = getClient(campaign.client_id)!;
  const brief = db().prepare("SELECT * FROM briefs WHERE id = ?").get(idea.brief_id) as unknown as BriefRow;

  let copy: CopyRow | undefined;
  if (spec.needs === "idea_copy") {
    copy = input.copyId ? (db().prepare("SELECT * FROM copy_variations WHERE id = ?").get(input.copyId) as CopyRow | undefined) : undefined;
    if (!copy) throw new WorkflowError("Choose approved ad copy first.");
    if (!USABLE.includes(copy.status) || !copy.is_current) throw new WorkflowError("That copy isn't approved yet. Approve it in Copywriting first.");
  }

  // Fill defaults for any option the user didn't send.
  const options = Object.fromEntries(spec.options.map((o) => [o.name, spec.options.find((x) => x.name === o.name)!.choices.includes(input.options[o.name]) ? input.options[o.name] : o.default]));
  const ctx: AgentContext = { client, campaign, brief, idea, copy, script, options };

  const out = await generateStructured({
    task: `agent.${agent}`,
    schema: spec.schema,
    system: spec.system,
    prompt:
      spec.prompt(ctx) +
      (input.previous ? `\n\nPREVIOUS VERSION (make a clearly improved alternative, keep the same JSON shape):\n${input.previous.slice(0, 4000)}` : "") +
      (input.instruction ? `\n\nREVIEWER NOTE FOR THIS VERSION: ${input.instruction}` : ""),
    mock: () => spec.mock(ctx),
    temperature: 0.8,
  });
  const qc: QCFlag[] = spec.qc(out.data, ctx);
  if (out.isMock) qc.push({ level: "info", code: "mock", message: "Mock provider: template output, not AI-generated." });
  if (agent === "static") await attachImages(out.data as StaticOut, qc, out.isMock);

  const id = Number(
    db()
      .prepare(
        "INSERT INTO agent_outputs (agent, campaign_id, idea_id, source_output_id, source_copy_id, options_json, content_json, qc_json, status, provider, model, created_at) VALUES (?,?,?,?,?,?,?,?, 'pending_review',?,?,?)",
      )
      .run(agent, campaign.id, idea.id, scriptRow?.id ?? null, copy?.id ?? null, JSON.stringify(options), JSON.stringify(out.data), JSON.stringify(qc), out.provider, out.model, now()).lastInsertRowid,
  );
  audit(`${agent}.generate`, "agent_output", id, `${name} via ${out.provider}/${out.model}`);
  return { id, isMock: out.isMock };
}

/** Regenerate with the same source and options (+ optional note). The old result is archived, not deleted. */
export async function regenerateOutput(id: number, instruction: string) {
  const old = getOutput(id);
  if (!old) throw new WorkflowError("Result not found");
  const r = await generateAgentOutput(old.agent, {
    ideaId: old.idea_id,
    copyId: old.source_copy_id ?? undefined,
    scriptId: old.source_output_id ?? undefined,
    options: JSON.parse(old.options_json),
    instruction,
    previous: old.content_json,
  });
  db().prepare("UPDATE agent_outputs SET status = 'archived' WHERE id = ?").run(id);
  recordApproval(`agent_output.${old.agent}`, id, "archived", `Replaced by regenerated #${r.id}${instruction ? `: ${instruction}` : ""}`);
  return r;
}

/**
 * Real ad images. With a token (Hugging Face / Pollinations) every concept gets an image now; on the free
 * anonymous tier (1 image per 45s) only the first concept does, and the rest get a "Generate image" button.
 * Failures become QC notes, never fake images.
 */
async function attachImages(data: StaticOut, qc: QCFlag[], isMock: boolean) {
  const provider = imageProvider();
  if (provider === "none" || isMock) {
    qc.push({ level: "info", code: "no_images", message: isMock ? "Mock provider: no images generated." : "Image generation is turned off (IMAGE_PROVIDER=none)." });
    return;
  }
  const targets = canGenerateInParallel() ? data.concepts.map((_, i) => i) : [0];
  const results = await Promise.allSettled(targets.map((i) => generateAdImage(data.concepts[i].image_prompt, 1000 + i * 17)));
  data.concepts.forEach((c) => (c.images = { square: null, tall: null, provider }));
  results.forEach((r, k) => {
    const c = data.concepts[targets[k]];
    if (r.status === "fulfilled") c.images = { square: r.value.url, tall: null, provider };
    else if (r.reason instanceof ImageRateLimit)
      qc.push({ level: "info", code: "image_wait", message: `“${c.name}”: the free image service needs a short pause; the image is made automatically on the campaign page.` });
    else qc.push({ level: "warning", code: "image_failed", message: `“${c.name}”: ${(r.reason as Error).message.slice(0, 160)}` });
  });
  if (provider === "pollinations")
    qc.push({ level: "info", code: "watermark", message: "Images from the free Pollinations service carry a small watermark. Add a free HF_TOKEN for clean FLUX images before using ads live." });
}

/**
 * Generate (or redo) the image for ONE concept of a static creative result. Other concepts are never touched.
 * An optional note ("warmer light, show the calf's face") is added to this concept's image prompt and kept.
 */
export async function generateConceptImage(outputId: number, index: number, instruction = "") {
  const o = getOutput(outputId);
  if (!o || o.agent !== "static") throw new WorkflowError("Result not found");
  if (o.status === "archived") throw new WorkflowError("This version was replaced by a newer one. Reload the page to see it.");
  const before = (JSON.parse(o.content_json) as StaticOut).concepts[index];
  if (!before) throw new WorkflowError("Concept not found");
  const note = isGenericNote(instruction) ? "" : instruction.trim();
  const base_prompt = before.base_prompt ?? before.image_prompt;
  const prompt = note ? (await rewriteImagePrompts([before], note))[0] : before.image_prompt;
  const img = await generateAdImage(prompt, 1000 + index * 17 + Math.floor(Math.random() * 1000));

  // Generating takes seconds; another concept's image may have been saved meanwhile. Re-read and change only this concept.
  const fresh = getOutput(outputId)!;
  const content = JSON.parse(fresh.content_json) as StaticOut;
  const c = content.concepts[index];
  c.images = { square: img.url, tall: null, provider: img.provider };
  if (note) Object.assign(c, { base_prompt, image_prompt: prompt });
  const qc = (JSON.parse(fresh.qc_json) as QCFlag[]).filter((f) => !((f.code === "image_failed" || f.code === "image_wait") && f.message.startsWith(`“${c.name}”`)));
  db().prepare("UPDATE agent_outputs SET content_json = ?, qc_json = ? WHERE id = ?").run(JSON.stringify(content), JSON.stringify(qc), outputId);
  audit("static.image", "agent_output", outputId, `Image for “${c.name}” via ${img.provider} (${Math.round(img.ms / 1000)}s)${note ? `: ${note}` : ""}`);
}

/**
 * "Regenerate" on image ads: keep the same concepts and redo their IMAGES with the reviewer's note.
 * Old images stay visible (marked pending) until the new ones arrive; the campaign page makes them one by one.
 * Button requests ("remove the Learn More button") change the ad template setting instead of the image.
 */
export async function redoStaticImages(outputId: number, instruction: string) {
  const o = getOutput(outputId);
  if (!o || o.agent !== "static") throw new WorkflowError("Result not found");
  if (o.status === "archived") throw new WorkflowError("This version was replaced by a newer one. Reload the page to see it.");
  const { showCta, rest } = parseButtonNote(instruction);
  const content = JSON.parse(o.content_json) as StaticOut;
  const redoImages = !!rest || showCta === undefined; // an empty note = "just give me new images"
  if (showCta !== undefined) content.show_cta = showCta;
  if (redoImages) {
    if (imageProvider() === "none") throw new WorkflowError("Image generation is turned off (IMAGE_PROVIDER=none).");
    const prompts = rest ? await rewriteImagePrompts(content.concepts, rest) : null;
    content.concepts.forEach((c, i) => {
      if (prompts) Object.assign(c, { base_prompt: c.base_prompt ?? c.image_prompt, image_prompt: prompts[i] });
      c.images = { square: c.images?.square ?? null, tall: null, provider: c.images?.provider ?? imageProvider(), pending: true };
    });
  }
  const status = o.status === "approved" ? "pending_review" : o.status; // changed work needs a fresh OK
  db().prepare("UPDATE agent_outputs SET content_json = ?, status = ? WHERE id = ?").run(JSON.stringify(content), status, outputId);
  const did = [showCta === false && "button hidden", showCta === true && "button shown", redoImages && `new images${rest ? `: ${rest}` : ""}`].filter(Boolean).join("; ");
  recordApproval("agent_output.static", outputId, status, `Updated: ${did}`);
  return { showCta, redoImages, rest, count: content.concepts.length };
}

const RewriteSchema = z.object({ prompts: z.array(z.string().min(20).max(1200)).min(1).max(4) });

/**
 * Apply a reviewer's note to image prompts. The photo model draws every noun it reads and cannot follow
 * "remove the animal" or "no text", so an art-director pass rewrites each prompt as a complete description
 * of the NEW picture, where removed things are simply absent. Always starts from the AI's original prompt.
 * If the AI is unavailable, falls back to original prompt + note (negated phrases are stripped before sending).
 */
export async function rewriteImagePrompts(concepts: StaticOut["concepts"], note: string): Promise<string[]> {
  const fallback = () => ({ prompts: concepts.map((c) => promptWithNote(c, note).image_prompt) });
  try {
    const out = await generateStructured({
      task: "static.image_note",
      schema: RewriteSchema,
      system: `You are an art director writing prompts for a photo-generation model (FLUX). The model draws every object word it reads and ignores negation, so "no dog" produces a dog.
Rules for every prompt you write:
- Describe ONLY what is visible in the photo: subject, action, setting, lighting, lens/camera, mood. 40–90 words, one paragraph.
- Apply the reviewer's note. If it removes something, rewrite the scene so that thing is simply absent and NEVER name it (not even "no X" or "without X"); fill the frame with something else that fits the concept.
- Never mention text, words, letters, typography, logos, signs, labels, watermarks, screens with writing, UI or buttons. If the note asks to remove text, describe clean plain surfaces.
- Authentic, photorealistic advertising photography. Keep the top third calm and uncluttered (open sky, plain wall or soft background); do not say why.
- The original prompt may contain old reviewer instructions; do not copy instructions, write a clean description.
Return JSON: {"prompts": ["...", ...]} with exactly one prompt per concept, in the same order.`,
      prompt: `Reviewer's note (apply to every concept): ${note}

Concepts:
${concepts.map((c, i) => `${i + 1}. ${c.name}: ${c.visual_concept}\n   Original prompt: ${(c.base_prompt ?? c.image_prompt).slice(0, 900)}`).join("\n")}`,
      mock: fallback,
      temperature: 0.4,
    });
    return out.data.prompts.length === concepts.length ? out.data.prompts : fallback().prompts;
  } catch {
    return fallback().prompts;
  }
}

/** The "Show button on image" switch beside the ad. */
export function setStaticShowCta(outputId: number, show: boolean) {
  const o = getOutput(outputId);
  if (!o || o.agent !== "static") throw new WorkflowError("Result not found");
  const content = JSON.parse(o.content_json) as StaticOut;
  content.show_cta = show;
  db().prepare("UPDATE agent_outputs SET content_json = ? WHERE id = ?").run(JSON.stringify(content), outputId);
  audit("static.button", "agent_output", outputId, show ? "Button shown on image" : "Button hidden on image");
}

const DECISIONS = { approve: "approved", reject: "rejected", request_changes: "changes_requested", archive: "archived" } as const;

export function decideOutput(id: number, decision: Decision, comment: string) {
  const row = getOutput(id);
  if (!row) throw new WorkflowError("Output not found");
  const qc = JSON.parse(row.qc_json) as QCFlag[];
  if (decision === "approve" && qc.some((f) => f.level === "error")) throw new WorkflowError("Fix the QC errors (regenerate) before approving.");
  db().prepare("UPDATE agent_outputs SET status = ? WHERE id = ?").run(DECISIONS[decision], id);
  recordApproval(`agent_output.${row.agent}`, id, DECISIONS[decision], comment);
}
