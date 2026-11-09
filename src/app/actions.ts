"use server";

import { revalidatePath } from "next/cache";
import { flushStore, syncStore } from "@/lib/db";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import type { ActionState } from "@/components/action-form";
import * as creative from "@/lib/creative/service";
import * as analytics from "@/lib/analytics/service";
import { AIGenerationError } from "@/lib/ai/generate";
import { COPY_FIELDS } from "@/lib/copy/logic";
import { ALLOWED_CTAS } from "@/lib/qc";
import { settingsFromForm } from "@/lib/run-settings";
import { generateSampleCsv } from "@/lib/analytics/sample";

/** Run an action; surface expected errors verbatim, hide unexpected ones behind a generic message. */
async function run(fn: () => Promise<string> | string, paths: string[] = ["/"]): Promise<ActionState> {
  try {
    await syncStore();
    const message = await fn();
    await flushStore();
    paths.forEach((p) => revalidatePath(p, "layout"));
    return { ok: true, message };
  } catch (e) {
    if (e instanceof z.ZodError) return { ok: false, message: e.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ") };
    if (e instanceof creative.WorkflowError || e instanceof analytics.ImportError || e instanceof AIGenerationError) return { ok: false, message: e.message };
    console.error(e);
    return { ok: false, message: "Unexpected error — see server logs." };
  }
}

const str = (min = 1, max = 2000) => z.string().trim().min(min).max(max);
const opt = (max = 2000) => z.string().trim().max(max).default("");
const id = z.coerce.number().int().positive();
const form = (fd: FormData) => Object.fromEntries(fd.entries());

/* ---------- Clients & campaigns ---------- */
export async function createClientAction(_: ActionState, fd: FormData) {
  return run(() => {
    const d = z
      .object({
        name: str(2, 120),
        sector: str(2, 200),
        brand_voice: opt(),
        brand_guidelines: opt(),
        banned_claims: opt(),
        ad_account_id: z.string().trim().max(40).regex(/^(act_)?\d*$/, "Meta ad account IDs look like act_123456789").default(""),
      })
      .parse(form(fd));
    creative.createClient(d);
    return `Client "${d.name}" created.`;
  });
}

export async function createCampaignAction(_: ActionState, fd: FormData) {
  let newId = 0;
  const res = await run(() => {
    const d = z.object({ client_id: id, name: str(2, 120), objective: str(2, 200), platform: z.enum(["meta"]) }).parse(form(fd));
    newId = creative.createCampaign(d);
    return "Campaign created.";
  });
  if (res?.ok) redirect(`/campaigns/${newId}`);
  return res;
}

export async function saveBriefAction(_: ActionState, fd: FormData) {
  return run(() => {
    const d = z
      .object({
        campaign_id: id,
        product: str(3, 300),
        audience: str(3, 500),
        pain_points: opt(),
        offer: opt(500),
        proof_points: opt(),
        tone: opt(200),
        cta: opt(40),
      })
      .parse(form(fd));
    const { campaign_id, ...brief } = d;
    creative.saveBrief(campaign_id, brief);
    return "Brief saved as a new version.";
  });
}

/* ---------- Ideas ---------- */
export async function generateIdeasAction(_: ActionState, fd: FormData) {
  return run(async () => {
    const d = z.object({ campaign_id: id, count: z.coerce.number().int().min(1).max(6), direction: opt(500) }).parse(form(fd));
    const r = await creative.generateIdeas(d.campaign_id, d.count, d.direction || undefined);
    return `${r.ids.length} ideas generated${r.isMock ? " (mock provider — template output)" : ` via ${r.provider}`}. Review them below.`;
  });
}

export async function decideIdeaAction(_: ActionState, fd: FormData) {
  return run(() => {
    const d = z.object({ idea_id: id, decision: z.enum(["approve", "reject", "request_changes", "archive"]), comment: opt(1000) }).parse(form(fd));
    creative.decideIdea(d.idea_id, d.decision, d.comment);
    return `Idea ${d.decision === "approve" ? "approved — you can now write copy from it" : d.decision.replace("_", " ") + "ed"}.`;
  });
}

export async function rateIdeaAction(_: ActionState, fd: FormData) {
  return run(() => {
    const d = z.object({ idea_id: id, rating: z.coerce.number().int().min(1).max(5) }).parse(form(fd));
    creative.rateIdea(d.idea_id, d.rating);
    return `Rated ${d.rating}/5 — used to steer future batches.`;
  });
}

/* ---------- Copy ---------- */
export async function generateCopyAction(_: ActionState, fd: FormData) {
  return run(async () => {
    const d = z.object({ idea_id: id, count: z.coerce.number().int().min(1).max(5) }).parse(form(fd));
    const r = await creative.generateCopy(d.idea_id, d.count);
    return `${r.ids.length} copy variations generated${r.isMock ? " (mock provider)" : ""}.`;
  });
}

export async function editCopyAction(_: ActionState, fd: FormData) {
  return run(() => {
    const d = z
      .object({ copy_id: id, hook: str(3, 200), headline: str(2, 120), primary_text: str(10, 1200), description: str(2, 120), cta: str(2, 40) })
      .parse(form(fd));
    const { copy_id, ...patch } = d;
    creative.editCopy(copy_id, patch);
    return "Saved as a new version (back to pending review).";
  });
}

export async function regenerateFieldAction(_: ActionState, fd: FormData) {
  return run(async () => {
    const d = z.object({ copy_id: id, field: z.enum(COPY_FIELDS), instruction: opt(300) }).parse(form(fd));
    await creative.regenerateCopyField(d.copy_id, d.field, d.instruction);
    return `Regenerated ${d.field.replace("_", " ")} as a new version.`;
  });
}

export async function decideCopyAction(_: ActionState, fd: FormData) {
  return run(() => {
    const d = z.object({ copy_id: id, decision: z.enum(["approve", "reject", "request_changes", "archive"]), comment: opt(1000) }).parse(form(fd));
    creative.decideCopy(d.copy_id, d.decision, d.comment);
    return d.decision === "approve" ? "Approved — marked ready for use." : "Decision recorded.";
  });
}

/* ---------- Toast / Media Buyer ---------- */
function importMessage(r: analytics.ImportResult) {
  if (r.fatal) throw new analytics.ImportError(r.fatal);
  const parts = [`${r.inserted} rows imported`, `${r.duplicates} duplicates skipped`];
  const rejectedRows = r.rejected.reduce((n, x) => n + (x.line ? 1 : 0), 0);
  if (rejectedRows) parts.push(`${rejectedRows} invalid rows rejected (first: line ${r.rejected.find((x) => x.line)?.line} — ${r.rejected.find((x) => x.line)?.errors[0]})`);
  if (r.unmappedAccounts.length) parts.push(`unmapped ad accounts rejected: ${r.unmappedAccounts.join(", ")}`);
  if (r.columns.ignored.length) parts.push(`ignored columns: ${r.columns.ignored.join(", ")}`);
  parts.push(`${r.newFindings} new Media Buyer findings`);
  return parts.join(" · ");
}

export async function importCsvAction(_: ActionState, fd: FormData) {
  return run(async () => {
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) throw new analytics.ImportError("Choose a CSV file to import.");
    if (file.size > 10 * 1024 * 1024) throw new analytics.ImportError("File is larger than 10 MB.");
    if (!/\.csv$/i.test(file.name)) throw new analytics.ImportError("Only .csv exports are supported.");
    return importMessage(analytics.importCsv(await file.text(), file.name, "upload"));
  });
}

export async function importSampleAction() {
  return run(async () => {
    const { getDb } = await import("@/lib/db");
    const { ensureSampleClients } = await import("@/lib/schema");
    ensureSampleClients(getDb()); // the sample CSV belongs to 3 fictional sample clients
    return importMessage(analytics.importCsv(generateSampleCsv(), "meta_ads_sample.csv (generated sample)", "sample"));
  });
}

export async function generateInsightAction(_: ActionState, fd: FormData) {
  return run(async () => {
    const d = z
      .object({ client_id: z.coerce.number().int().optional().catch(undefined), from: opt(10), to: opt(10) })
      .parse(form(fd));
    await analytics.generateInsight({ clientId: d.client_id || undefined, from: d.from || undefined, to: d.to || undefined });
    return "Summary generated from the imported data.";
  });
}

export async function decideRecommendationAction(_: ActionState, fd: FormData) {
  return run(() => {
    const d = z.object({ rec_id: id, decision: z.enum(["approve", "reject", "dismiss"]), comment: opt(1000) }).parse(form(fd));
    analytics.decideRecommendation(d.rec_id, d.decision, d.comment);
    return d.decision === "approve"
      ? "Accepted and logged. No change was made in any ad account — action it in Ads Manager."
      : "Decision recorded.";
  });
}

/* ---------- Production agents (script, static, UGC, edit, landing) ---------- */
export async function generateAgentAction(_: ActionState, fd: FormData) {
  return run(async () => {
    const { PRODUCTION_AGENTS } = await import("@/lib/agents/registry");
    const { generateAgentOutput } = await import("@/lib/agents/service");
    const raw = form(fd);
    const d = z
      .object({
        agent: z.enum(PRODUCTION_AGENTS),
        idea_id: z.coerce.number().int().positive().optional().catch(undefined),
        copy_id: z.coerce.number().int().positive().optional().catch(undefined),
        script_id: z.coerce.number().int().positive().optional().catch(undefined),
      })
      .parse(raw);
    const options = Object.fromEntries(Object.entries(raw).filter(([k]) => k.startsWith("opt_")).map(([k, v]) => [k.slice(4), String(v)]));
    const r = await generateAgentOutput(d.agent, { ideaId: d.idea_id, copyId: d.copy_id, scriptId: d.script_id, options });
    return `Done. Your result is ready below for review${r.isMock ? " (mock provider, template output)" : ""}.`;
  });
}

export async function decideAgentOutputAction(_: ActionState, fd: FormData) {
  return run(async () => {
    const { decideOutput } = await import("@/lib/agents/service");
    const d = z.object({ output_id: id, decision: z.enum(["approve", "reject", "request_changes", "archive"]), comment: opt(1000) }).parse(form(fd));
    decideOutput(d.output_id, d.decision, d.comment);
    return d.decision === "approve" ? "Approved. It can now be used by the next agent." : "Decision recorded.";
  });
}

/* ---------- Regenerate ---------- */
export async function regenerateIdeaAction(_: ActionState, fd: FormData) {
  return run(async () => {
    const d = z.object({ idea_id: id, instruction: opt(400) }).parse(form(fd));
    const newId = await creative.regenerateIdea(d.idea_id, d.instruction);
    return `New version ready (#${newId}). The old one was archived.`;
  });
}

export async function regenerateCopyAction(_: ActionState, fd: FormData) {
  return run(async () => {
    const d = z.object({ copy_id: id, instruction: opt(400) }).parse(form(fd));
    await creative.regenerateCopy(d.copy_id, d.instruction);
    return "New version ready for review.";
  });
}

export async function regenerateAgentAction(_: ActionState, fd: FormData) {
  return run(async () => {
    const { getOutput, redoStaticImages, regenerateOutput } = await import("@/lib/agents/service");
    const d = z.object({ output_id: id, instruction: opt(400) }).parse(form(fd));
    // Image ads: keep the concepts and redo the images (and handle button requests), never wipe everything.
    if (getOutput(d.output_id)?.agent === "static") {
      const r = await redoStaticImages(d.output_id, d.instruction);
      const parts = [r.showCta === false && "Button removed from the ad.", r.showCta === true && "Button added back to the ad."];
      if (r.redoImages) parts.push(`Making ${r.count} new image${r.count > 1 ? "s" : ""}${r.rest ? ` (“${r.rest}”)` : ""}. The current ones stay until each new one is ready.`);
      return parts.filter(Boolean).join(" ");
    }
    const r = await regenerateOutput(d.output_id, d.instruction);
    return `New version ready (#${r.id}). The old one was archived.`;
  });
}

export async function setShowCtaAction(outputId: number, show: boolean) {
  const { setStaticShowCta } = await import("@/lib/agents/service");
  const d = z.object({ outputId: z.number().int().positive(), show: z.boolean() }).parse({ outputId, show });
  await syncStore();
  setStaticShowCta(d.outputId, d.show);
  await flushStore();
  revalidatePath("/", "layout");
}

/* ---------- AI autopilot ---------- */
/** One form → client (existing or new) + campaign + brief → the AI runs every agent in the background. */
export async function createAndRunAction(_: ActionState, fd: FormData) {
  const { startRun, runAutopilot } = await import("@/lib/autopilot");
  let campaignId = 0;
  const res = await run(() => {
    const d = z
      .object({
        client_id: z.string().default(""),
        new_client: z.string().trim().max(120).default(""),
        name: z.string().trim().max(120).default(""),
        goal: str(2, 120),
        product: str(3, 300),
        audience: str(3, 500),
        offer: opt(500),
        proof_points: opt(),
        pain_points: opt(),
        tone: opt(200),
        cta: z.enum(ALLOWED_CTAS).default("Learn More"),
      })
      .parse(form(fd));
    let clientId = Number(d.client_id) || 0;
    if (!clientId) {
      if (d.new_client.length < 2) throw new creative.WorkflowError("Choose a client or type a new client name.");
      clientId = creative.createClient({ name: d.new_client, sector: "—", brand_voice: "", brand_guidelines: "", banned_claims: "" });
    }
    // No campaign-name field on the form any more: name it after what's being promoted.
    const name = d.name.length >= 2 ? d.name : `${d.goal}: ${d.product}`.slice(0, 120);
    campaignId = creative.createCampaign({ client_id: clientId, name, objective: d.goal, platform: "meta" });
    creative.saveCampaignSettings(campaignId, settingsFromForm(fd));
    creative.saveBrief(campaignId, { product: d.product, audience: d.audience, offer: d.offer, proof_points: d.proof_points, pain_points: d.pain_points, tone: d.tone, cta: d.cta });
    const runId = startRun(campaignId);
    after(() => runAutopilot(runId).catch((e) => console.error("autopilot", e)));
    return "Campaign created. The AI is building it now.";
  });
  if (res?.ok) redirect(`/campaigns/${campaignId}`);
  return res;
}

export async function rerunAction(_: ActionState, fd: FormData) {
  const { startRun, runAutopilot } = await import("@/lib/autopilot");
  return run(() => {
    const d = z.object({ campaign_id: id }).parse(form(fd));
    if (fd.get("s_present")) creative.saveCampaignSettings(d.campaign_id, settingsFromForm(fd));
    const runId = startRun(d.campaign_id);
    after(() => runAutopilot(runId).catch((e) => console.error("autopilot", e)));
    return "The AI has started a fresh run. Results appear below as each step finishes.";
  });
}

export async function approveAllAction(_: ActionState, fd: FormData) {
  const { approveAll } = await import("@/lib/autopilot");
  return run(() => {
    const d = z.object({ campaign_id: id }).parse(form(fd));
    const r = approveAll(d.campaign_id);
    return `Approved ${r.approved} item${r.approved === 1 ? "" : "s"}${r.blocked ? `. ${r.blocked} need a fix first (marked ✕)` : ""}.`;
  });
}

/* ---------- Fill with AI ---------- */
export async function suggestFormAction(
  kind: "campaign" | "brief" | "client",
  typed: Record<string, string>,
  ctx: { clientId?: number; campaignId?: number },
) {
  const { suggestFields } = await import("@/lib/suggest");
  try {
    const k = z.enum(["campaign", "brief", "client"]).parse(kind);
    const clean = Object.fromEntries(Object.entries(typed ?? {}).slice(0, 30).map(([a, b]) => [String(a).slice(0, 40), String(b ?? "").slice(0, 2000)]));
    await syncStore();
    const r = await suggestFields(k, clean, { clientId: Number(ctx?.clientId) || undefined, campaignId: Number(ctx?.campaignId) || undefined });
    return { ok: true as const, message: "", ...r };
  } catch (e) {
    const message = e instanceof AIGenerationError ? e.message : "Couldn't get suggestions right now.";
    if (!(e instanceof AIGenerationError)) console.error(e);
    return { ok: false as const, message, values: {}, sources: {}, skipped: [], isMock: false };
  }
}

export async function suggestFieldAction(field: string, typed: Record<string, string>, ctx: { clientId?: number; campaignId?: number }) {
  const { suggestOne } = await import("@/lib/suggest");
  try {
    const clean = Object.fromEntries(Object.entries(typed ?? {}).slice(0, 30).map(([a, b]) => [String(a).slice(0, 40), String(b ?? "").slice(0, 2000)]));
    await syncStore();
    const r = await suggestOne(String(field).slice(0, 40), clean, { clientId: Number(ctx?.clientId) || undefined, campaignId: Number(ctx?.campaignId) || undefined });
    return { ok: true as const, message: "", ...r };
  } catch (e) {
    const message = e instanceof AIGenerationError ? e.message : "Couldn't get suggestions right now.";
    if (!(e instanceof AIGenerationError)) console.error(e);
    return { ok: false as const, message, options: [] as string[], source: "", skipped: 0, isMock: false, mode: "replace" as const };
  }
}

export async function generateConceptImageAction(_: ActionState, fd: FormData) {
  const { generateConceptImage } = await import("@/lib/agents/service");
  const { ImageRateLimit } = await import("@/lib/images");
  try {
    const d = z.object({ output_id: id, index: z.coerce.number().int().min(0).max(5), instruction: opt(300) }).parse(form(fd));
    await syncStore();
    await generateConceptImage(d.output_id, d.index, d.instruction);
    await flushStore();
    ["/"].forEach((p) => revalidatePath(p, "layout"));
    return { ok: true, message: "Image ready." };
  } catch (e) {
    if (e instanceof ImageRateLimit) return { ok: false, message: e.message, rateLimited: true };
    if (e instanceof creative.WorkflowError) return { ok: false, message: e.message };
    console.error(e);
    return { ok: false, message: `Image generation failed: ${(e as Error).message.slice(0, 160)}` };
  }
}
