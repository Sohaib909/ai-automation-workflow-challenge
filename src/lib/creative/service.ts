import "server-only";
import { randomUUID } from "node:crypto";
import { getDb, now, tx } from "../db";
import { audit, recordApproval } from "../audit";
import { generateStructured } from "../ai/generate";
import { checkClaims, similarity, type QCFlag } from "../qc";
import {
  IDEA_SYSTEM,
  IdeaBatchSchema,
  type IdeaContext,
  buildIdeaPrompt,
  LENSES,
  mockIdeas,
  pickLenses,
  totalScore,
} from "../ideas/logic";
import {
  COPY_FIELDS,
  COPY_SYSTEM,
  CopyBatchSchema,
  type CopyField,
  type CopyVariation,
  FieldRegenSchema,
  buildCopyPrompt,
  buildFieldPrompt,
  mockCopy,
  mockField,
  runCopyQC,
} from "../copy/logic";

/* ---------- Row types ---------- */
export interface ClientRow {
  id: number;
  name: string;
  sector: string;
  brand_voice: string;
  brand_guidelines: string;
  banned_claims: string;
  is_sample: number;
}
export interface CampaignRow {
  id: number;
  client_id: number;
  name: string;
  objective: string;
  platform: string;
  settings_json: string;
  created_at: string;
}
export interface BriefRow {
  id: number;
  campaign_id: number;
  version: number;
  product: string;
  audience: string;
  pain_points: string;
  offer: string;
  proof_points: string;
  tone: string;
  cta: string;
  created_at: string;
}
export interface IdeaRow {
  id: number;
  campaign_id: number;
  brief_id: number;
  batch_id: string;
  title: string;
  lens: string;
  core_concept: string;
  audience_insight: string;
  hook: string;
  visual_direction: string;
  copy_direction: string;
  video_concept: string;
  test_hypothesis: string;
  rationale: string;
  scores_json: string;
  total_score: number;
  warnings_json: string;
  learnings_used_json: string;
  status: string;
  rating: number | null;
  provider: string;
  model: string;
  created_at: string;
}
export interface CopyRow extends CopyVariation {
  id: number;
  campaign_id: number;
  idea_id: number;
  batch_id: string;
  lineage_id: string;
  version: number;
  is_current: number;
  qc_json: string;
  status: string;
  change_note: string;
  provider: string;
  model: string;
  created_at: string;
}

export class WorkflowError extends Error {}

/** Statuses an item can have and still feed the next agent: human-approved, or the AI autopilot's pick awaiting review. */
export const USABLE = ["approved", "ai_selected"];

const db = () => getDb();

/* ---------- Clients & campaigns ---------- */
export function listClients() {
  return db()
    .prepare(
      `SELECT c.*, (SELECT COUNT(*) FROM campaigns k WHERE k.client_id = c.id) AS campaign_count,
              (SELECT GROUP_CONCAT(external_id, ', ') FROM ad_accounts a WHERE a.client_id = c.id) AS ad_accounts
       FROM clients c ORDER BY c.name`,
    )
    .all() as unknown as (ClientRow & { campaign_count: number; ad_accounts: string | null })[];
}

export function getClient(id: number) {
  return db().prepare("SELECT * FROM clients WHERE id = ?").get(id) as ClientRow | undefined;
}

export function createClient(input: Omit<ClientRow, "id" | "is_sample"> & { ad_account_id?: string }) {
  if (db().prepare("SELECT 1 FROM clients WHERE name = ?").get(input.name)) throw new WorkflowError(`A client called "${input.name}" already exists.`);
  const acct = input.ad_account_id?.trim();
  const external = acct ? (acct.startsWith("act_") ? acct : `act_${acct}`) : "";
  if (external && db().prepare("SELECT 1 FROM ad_accounts WHERE external_id = ?").get(external)) throw new WorkflowError(`Ad account ${external} is already linked to another client.`);
  const id = Number(
    db()
      .prepare("INSERT INTO clients (name, sector, brand_voice, brand_guidelines, banned_claims, created_at) VALUES (?,?,?,?,?,?)")
      .run(input.name, input.sector, input.brand_voice, input.brand_guidelines, input.banned_claims, now()).lastInsertRowid,
  );
  if (external) db().prepare("INSERT INTO ad_accounts (client_id, external_id, name) VALUES (?,?,?)").run(id, external, input.name);
  audit("client.create", "client", id, `${input.name}${external ? ` (ad account ${external})` : ""}`);
  return id;
}

export function listCampaigns(clientId?: number) {
  const sql = `SELECT k.*, c.name AS client_name,
      (SELECT COUNT(*) FROM ideas i WHERE i.campaign_id = k.id) AS idea_count,
      (SELECT COUNT(*) FROM ideas i WHERE i.campaign_id = k.id AND i.status = 'approved') AS approved_ideas,
      (SELECT COUNT(*) FROM copy_variations v WHERE v.campaign_id = k.id AND v.is_current = 1 AND v.status = 'approved') AS approved_copy
    FROM campaigns k JOIN clients c ON c.id = k.client_id ${clientId ? "WHERE k.client_id = ?" : ""} ORDER BY k.created_at DESC, k.id DESC`;
  const stmt = db().prepare(sql);
  return (clientId ? stmt.all(clientId) : stmt.all()) as unknown as (CampaignRow & {
    client_name: string;
    idea_count: number;
    approved_ideas: number;
    approved_copy: number;
  })[];
}

export function createCampaign(input: { client_id: number; name: string; objective: string; platform: string }) {
  if (!getClient(input.client_id)) throw new WorkflowError("Client not found");
  const id = Number(
    db()
      .prepare("INSERT INTO campaigns (client_id, name, objective, platform, created_at) VALUES (?,?,?,?,?)")
      .run(input.client_id, input.name, input.objective, input.platform, now()).lastInsertRowid,
  );
  audit("campaign.create", "campaign", id, input.name);
  return id;
}

export function saveCampaignSettings(id: number, settings: object) {
  db().prepare("UPDATE campaigns SET settings_json = ? WHERE id = ?").run(JSON.stringify(settings), id);
}

export function getCampaign(id: number) {
  return db().prepare("SELECT * FROM campaigns WHERE id = ?").get(id) as CampaignRow | undefined;
}

export function latestBrief(campaignId: number) {
  return db().prepare("SELECT * FROM briefs WHERE campaign_id = ? ORDER BY version DESC LIMIT 1").get(campaignId) as BriefRow | undefined;
}

/** Briefs are versioned: editing creates v+1 so ideas keep pointing at the brief they came from. */
export function saveBrief(campaignId: number, b: Omit<BriefRow, "id" | "campaign_id" | "version" | "created_at">) {
  const prev = latestBrief(campaignId);
  const version = (prev?.version ?? 0) + 1;
  const id = Number(
    db()
      .prepare(
        "INSERT INTO briefs (campaign_id, version, product, audience, pain_points, offer, proof_points, tone, cta, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      )
      .run(campaignId, version, b.product, b.audience, b.pain_points, b.offer, b.proof_points, b.tone, b.cta, now()).lastInsertRowid,
  );
  audit("brief.save", "campaign", campaignId, `Brief v${version}`);
  return id;
}

/* ---------- Performance → ideas feedback loop ---------- */
export function clientLearnings(clientId: number): { id: number; text: string; source: string }[] {
  const recs = db()
    .prepare(
      "SELECT id, learning FROM recommendations WHERE client_id = ? AND status = 'approved' AND learning IS NOT NULL ORDER BY id DESC LIMIT 5",
    )
    .all(clientId) as { id: number; learning: string }[];
  return recs.map((r) => ({ id: r.id, text: r.learning, source: `Media Buyer recommendation #${r.id} (approved)` }));
}

/* ---------- Ideas ---------- */
function ideaContext(campaignId: number, count: number, direction?: string): { ctx: IdeaContext; brief: BriefRow; campaign: CampaignRow; client: ClientRow } {
  const campaign = getCampaign(campaignId);
  if (!campaign) throw new WorkflowError("Campaign not found");
  const client = getClient(campaign.client_id)!;
  const brief = latestBrief(campaignId);
  if (!brief) throw new WorkflowError("Add a campaign brief before generating ideas.");
  const previous = db()
    .prepare("SELECT title, hook, status, rating, lens FROM ideas WHERE campaign_id = ? ORDER BY id DESC LIMIT 30")
    .all(campaignId) as { title: string; hook: string; status: string; rating: number | null; lens: string }[];
  return {
    campaign,
    client,
    brief,
    ctx: {
      client,
      campaign,
      brief,
      previous,
      learnings: clientLearnings(client.id).map((l) => l.text),
      direction,
      count,
    },
  };
}

export async function generateIdeas(campaignId: number, count: number, direction?: string, forceLens?: string) {
  const { ctx, brief, client } = ideaContext(campaignId, count, direction);
  const prevRows = db().prepare("SELECT id, title, hook, lens FROM ideas WHERE campaign_id = ?").all(campaignId) as {
    id: number;
    title: string;
    hook: string;
    lens: string;
  }[];
  const forced = forceLens ? LENSES.find((l) => l.name === forceLens) : undefined;
  const lenses = forced ? [forced] : pickLenses(count, prevRows.map((p) => p.lens));

  const out = await generateStructured({
    task: "idea_generation",
    schema: IdeaBatchSchema,
    system: IDEA_SYSTEM,
    prompt: buildIdeaPrompt(ctx, lenses),
    mock: () => mockIdeas(ctx, lenses),
  });

  const batch = randomUUID();
  const learnings = clientLearnings(client.id);
  const factSource = `${brief.offer}\n${brief.proof_points}`;
  const insert = db().prepare(
    `INSERT INTO ideas (campaign_id, brief_id, batch_id, title, lens, core_concept, audience_insight, hook, visual_direction, copy_direction,
      video_concept, test_hypothesis, rationale, scores_json, total_score, warnings_json, learnings_used_json, status, provider, model, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pending_review',?,?,?)`,
  );
  const ids = tx(() =>
    out.data.ideas.map((idea) => {
      const warnings: QCFlag[] = [
        ...checkClaims(`${idea.hook} ${idea.core_concept}`, { factSource, bannedClaims: client.banned_claims.split("\n").filter(Boolean) }),
      ];
      const dup = prevRows.find((p) => similarity(`${p.title} ${p.hook}`, `${idea.title} ${idea.hook}`) >= 0.5);
      if (dup) warnings.push({ level: "warning", code: "near_duplicate", message: `Very similar to earlier idea #${dup.id} "${dup.title}".` });
      if (out.isMock) warnings.push({ level: "info", code: "mock", message: "Mock provider: template output, not AI-generated. Scores are placeholders." });
      return Number(
        insert.run(
          campaignId,
          brief.id,
          batch,
          idea.title,
          idea.lens,
          idea.core_concept,
          idea.audience_insight,
          idea.hook,
          idea.visual_direction,
          idea.copy_direction,
          idea.video_concept,
          idea.test_hypothesis,
          idea.rationale,
          JSON.stringify(idea.scores),
          totalScore(idea.scores),
          JSON.stringify(warnings),
          JSON.stringify(learnings),
          out.provider,
          out.model,
          now(),
        ).lastInsertRowid,
      );
    }),
  );
  audit("ideas.generate", "campaign", campaignId, `${ids.length} ideas via ${out.provider}/${out.model}${direction ? ` — direction: ${direction}` : ""}`);
  return { ids, provider: out.provider, isMock: out.isMock };
}

export function listIdeas(campaignId: number) {
  // Archived ideas (replaced by a regenerated version) stay in the DB for history but are hidden from the UI.
  return db().prepare("SELECT * FROM ideas WHERE campaign_id = ? AND status != 'archived' ORDER BY id DESC").all(campaignId) as unknown as IdeaRow[];
}

export function getIdea(id: number) {
  return db().prepare("SELECT * FROM ideas WHERE id = ?").get(id) as IdeaRow | undefined;
}

const DECISIONS = { approve: "approved", reject: "rejected", request_changes: "changes_requested", archive: "archived" } as const;
export type Decision = keyof typeof DECISIONS;

export function decideIdea(id: number, decision: Decision, comment: string) {
  const idea = getIdea(id);
  if (!idea) throw new WorkflowError("Idea not found");
  db().prepare("UPDATE ideas SET status = ? WHERE id = ?").run(DECISIONS[decision], id);
  recordApproval("idea", id, DECISIONS[decision], comment);
}

/** Regenerate one idea: same creative lens, optional reviewer note. The old idea is archived, not deleted. */
export async function regenerateIdea(id: number, instruction: string) {
  const old = getIdea(id);
  if (!old) throw new WorkflowError("Idea not found");
  const direction = `Rework the idea "${old.title}" (hook: "${old.hook}") into a stronger, clearly different version.${instruction ? ` Reviewer note: ${instruction}` : ""}`;
  const r = await generateIdeas(old.campaign_id, 1, direction, old.lens);
  db().prepare("UPDATE ideas SET status = 'archived' WHERE id = ?").run(id);
  // A replacement for the chosen idea takes its place as the AI pick (still needs a person's OK).
  if (USABLE.includes(old.status)) db().prepare("UPDATE ideas SET status = 'ai_selected' WHERE id = ?").run(r.ids[0]);
  recordApproval("idea", id, "archived", `Replaced by regenerated idea #${r.ids[0]}${instruction ? `: ${instruction}` : ""}`);
  return r.ids[0];
}

export function rateIdea(id: number, rating: number) {
  if (rating < 1 || rating > 5) throw new WorkflowError("Rating must be 1–5");
  db().prepare("UPDATE ideas SET rating = ? WHERE id = ?").run(rating, id);
  audit("idea.rate", "idea", id, `${rating}/5`);
}

/* ---------- Copy ---------- */
function copyContext(ideaId: number) {
  const idea = getIdea(ideaId);
  if (!idea) throw new WorkflowError("Idea not found");
  // Workflow gate: copy is only produced from human-approved ideas.
  if (idea.status === "archived") throw new WorkflowError("This copy was written for an idea you've since replaced. Click “Run the AI again” to rebuild from the new idea.");
  if (!USABLE.includes(idea.status)) throw new WorkflowError("Only approved ideas can be sent to copywriting.");
  const campaign = getCampaign(idea.campaign_id)!;
  const client = getClient(campaign.client_id)!;
  const brief = db().prepare("SELECT * FROM briefs WHERE id = ?").get(idea.brief_id) as unknown as BriefRow;
  return {
    idea,
    campaign,
    client,
    brief,
    ctx: { client, campaign, brief },
    qcCtx: {
      factSource: `${brief.offer}\n${brief.proof_points}`,
      bannedClaims: client.banned_claims.split("\n").filter(Boolean),
      platform: campaign.platform,
    },
  };
}

const insertCopy = () =>
  db().prepare(
    `INSERT INTO copy_variations (campaign_id, idea_id, batch_id, lineage_id, version, is_current, angle, hook, headline, primary_text, description, cta,
      qc_json, status, change_note, provider, model, created_at) VALUES (?,?,?,?,?,1,?,?,?,?,?,?,?,'pending_review',?,?,?,?)`,
  );

export async function generateCopy(ideaId: number, count: number) {
  const { idea, ctx, qcCtx } = copyContext(ideaId);
  const out = await generateStructured({
    task: "copywriting",
    schema: CopyBatchSchema,
    system: COPY_SYSTEM,
    prompt: buildCopyPrompt(ctx, idea, count),
    mock: () => mockCopy(ctx, idea, count),
    temperature: 0.8,
  });
  const batch = randomUUID();
  const stmt = insertCopy();
  const ids = tx(() =>
    out.data.variations.map((v) => {
      const qc = runCopyQC(v, qcCtx);
      if (out.isMock) qc.push({ level: "info", code: "mock", message: "Mock provider: template output, not AI-generated." });
      return Number(
        stmt.run(idea.campaign_id, idea.id, batch, randomUUID(), 1, v.angle, v.hook, v.headline, v.primary_text, v.description, v.cta, JSON.stringify(qc), "Generated", out.provider, out.model, now())
          .lastInsertRowid,
      );
    }),
  );
  audit("copy.generate", "idea", ideaId, `${ids.length} variations via ${out.provider}/${out.model}`);
  return { ids, isMock: out.isMock };
}

export function listCopy(campaignId: number) {
  return db()
    .prepare("SELECT * FROM copy_variations WHERE campaign_id = ? AND is_current = 1 ORDER BY idea_id DESC, id")
    .all(campaignId) as unknown as CopyRow[];
}

export function copyVersions(lineageId: string) {
  return db().prepare("SELECT * FROM copy_variations WHERE lineage_id = ? ORDER BY version DESC").all(lineageId) as unknown as CopyRow[];
}

function getCopy(id: number) {
  return db().prepare("SELECT * FROM copy_variations WHERE id = ?").get(id) as CopyRow | undefined;
}

/** Any content change creates a new version and resets approval — approved copy can't be silently altered. */
function newVersion(prev: CopyRow, patch: Partial<CopyVariation>, note: string, provider: string, model: string, extraQc: QCFlag[] = []) {
  const { qcCtx } = copyContext(prev.idea_id);
  const next: CopyVariation = {
    angle: prev.angle,
    hook: prev.hook,
    headline: prev.headline,
    primary_text: prev.primary_text,
    description: prev.description,
    cta: prev.cta,
    ...patch,
  };
  const qc = [...runCopyQC(next, qcCtx), ...extraQc];
  return tx(() => {
    db().prepare("UPDATE copy_variations SET is_current = 0 WHERE lineage_id = ?").run(prev.lineage_id);
    const id = Number(
      insertCopy()
        .run(prev.campaign_id, prev.idea_id, prev.batch_id, prev.lineage_id, prev.version + 1, next.angle, next.hook, next.headline, next.primary_text, next.description, next.cta, JSON.stringify(qc), note, provider, model, now())
        .lastInsertRowid,
    );
    audit("copy.version", "copy_variation", id, `v${prev.version + 1}: ${note}`);
    return id;
  });
}

export function editCopy(id: number, patch: Partial<CopyVariation>) {
  const prev = getCopy(id);
  if (!prev || !prev.is_current) throw new WorkflowError("Only the current version can be edited.");
  const changed = COPY_FIELDS.filter((f) => patch[f] !== undefined && patch[f] !== prev[f]);
  if (!changed.length) throw new WorkflowError("No changes to save.");
  return newVersion(prev, patch, `Edited by reviewer: ${changed.join(", ")}`, "human", "-");
}

export async function regenerateCopyField(id: number, field: CopyField, instruction: string) {
  const prev = getCopy(id);
  if (!prev || !prev.is_current) throw new WorkflowError("Only the current version can be regenerated.");
  const { idea, ctx } = copyContext(prev.idea_id);
  const out = await generateStructured({
    task: "copywriting.field",
    schema: FieldRegenSchema,
    system: COPY_SYSTEM,
    prompt: buildFieldPrompt(ctx, idea, prev, field, instruction),
    mock: () => mockField(prev, field),
    temperature: 0.9,
  });
  const extra: QCFlag[] = out.isMock ? [{ level: "info", code: "mock", message: "Mock provider: template output, not AI-generated." }] : [];
  return newVersion(prev, { [field]: out.data.value.trim() }, `Regenerated ${field}${instruction ? `: ${instruction}` : ""}`, out.provider, out.model, extra);
}

/** Regenerate a whole copy variation as a new version (same idea, optional reviewer note). */
export async function regenerateCopy(id: number, instruction: string) {
  const prev = getCopy(id);
  if (!prev || !prev.is_current) throw new WorkflowError("Only the current version can be regenerated.");
  const { idea, ctx } = copyContext(prev.idea_id);
  const note = `Rewrite this variation (angle: "${prev.angle}") so it is clearly better. Current version: ${JSON.stringify({ hook: prev.hook, headline: prev.headline, primary_text: prev.primary_text })}.${instruction ? ` Reviewer note: ${instruction}` : ""}`;
  const out = await generateStructured({
    task: "copywriting.regenerate",
    schema: CopyBatchSchema,
    system: COPY_SYSTEM,
    prompt: `${buildCopyPrompt(ctx, idea, 1)}

${note}`,
    mock: () => {
      const m = mockCopy(ctx, idea, 2).variations[1];
      return { variations: [{ ...m, angle: prev.angle }] };
    },
    temperature: 0.9,
  });
  const v = out.data.variations[0];
  const extra: QCFlag[] = out.isMock ? [{ level: "info", code: "mock", message: "Mock provider: template output, not AI-generated." }] : [];
  return newVersion(prev, v, `Regenerated${instruction ? `: ${instruction}` : ""}`, out.provider, out.model, extra);
}

export function decideCopy(id: number, decision: Decision, comment: string) {
  const row = getCopy(id);
  if (!row || !row.is_current) throw new WorkflowError("Only the current version can be reviewed.");
  const qc = JSON.parse(row.qc_json) as QCFlag[];
  if (decision === "approve" && qc.some((f) => f.level === "error")) {
    throw new WorkflowError("Fix QC errors (e.g. banned claims, invalid CTA) before approving.");
  }
  db().prepare("UPDATE copy_variations SET status = ? WHERE id = ?").run(DECISIONS[decision], id);
  recordApproval("copy_variation", id, DECISIONS[decision], comment);
}

export function exportApprovedCopyCSV(campaignId: number): string {
  const rows = db()
    .prepare(
      `SELECT v.id, i.title AS idea, v.angle, v.hook, v.headline, v.primary_text, v.description, v.cta, v.version, v.provider, v.model
       FROM copy_variations v JOIN ideas i ON i.id = v.idea_id
       WHERE v.campaign_id = ? AND v.is_current = 1 AND v.status = 'approved' ORDER BY v.id`,
    )
    .all(campaignId) as Record<string, string | number>[];
  const cols = ["id", "idea", "angle", "hook", "headline", "primary_text", "description", "cta", "version", "provider", "model"];
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}
