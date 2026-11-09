import "server-only";
import { flushStore, getDb, now, syncStore } from "./db";
import { audit } from "./audit";
import * as creative from "./creative/service";
import * as agents from "./agents/service";
import type { QCFlag } from "./qc";
import { parseSettings } from "./run-settings";
import { TOOL_NAMES } from "./tool-names";

/**
 * AI autopilot: runs every production agent for a campaign in sequence, automatically picking the
 * strongest option at each step (score + QC). Nothing is approved automatically — every output lands
 * as "AI pick · needs your OK" or "pending review" for one human review at the end.
 */

export type StepStatus = "waiting" | "running" | "done" | "failed" | "skipped";
export interface RunStep {
  key: string;
  label: string;
  status: StepStatus;
  detail: string;
  started_at?: string;
  finished_at?: string;
}

const STEPS: Omit<RunStep, "status" | "detail">[] = [
  { key: "ideas", label: `${TOOL_NAMES.ideas}: ideas & pick the strongest` },
  { key: "copy", label: `${TOOL_NAMES.copy}: write & pick the best version` },
  { key: "static", label: `${TOOL_NAMES.static}: image ad concepts` },
  { key: "script", label: `${TOOL_NAMES.script}: video script` },
  { key: "ugc", label: `${TOOL_NAMES.ugc}: production pack` },
  { key: "edit", label: `${TOOL_NAMES.edit}: edit plan` },
  { key: "landing", label: `${TOOL_NAMES.landing}: build the page` },
];

/** Step labels are saved with each run; show the current name so older runs match the new wording. */
export const stepLabel = (s: Pick<RunStep, "key" | "label">) => STEPS.find((x) => x.key === s.key)?.label ?? s.label;

export interface RunRow {
  id: number;
  campaign_id: number;
  status: string;
  steps_json: string;
  started_at: string;
  finished_at: string | null;
}

const db = () => getDb();

export function latestRun(campaignId: number) {
  const r = db().prepare("SELECT * FROM workflow_runs WHERE campaign_id = ? ORDER BY id DESC LIMIT 1").get(campaignId) as RunRow | undefined;
  return r ? { ...r, steps: JSON.parse(r.steps_json) as RunStep[] } : null;
}

export function startRun(campaignId: number): number {
  const running = db().prepare("SELECT id FROM workflow_runs WHERE campaign_id = ? AND status = 'running'").get(campaignId) as { id: number } | undefined;
  if (running) throw new creative.WorkflowError("The AI is already working on this campaign.");
  if (!creative.latestBrief(campaignId)) throw new creative.WorkflowError("Add a brief first.");
  const steps: RunStep[] = STEPS.map((s) => ({ ...s, status: "waiting", detail: "" }));
  const id = Number(
    db().prepare("INSERT INTO workflow_runs (campaign_id, status, steps_json, started_at) VALUES (?, 'running', ?, ?)").run(campaignId, JSON.stringify(steps), now()).lastInsertRowid,
  );
  audit("autopilot.start", "campaign", campaignId, `Run #${id}`);
  return id;
}

const errorCount = (json: string) => (JSON.parse(json) as QCFlag[]).filter((f) => f.level === "error").length;
const warnCount = (json: string) => (JSON.parse(json) as QCFlag[]).filter((f) => f.level === "warning").length;

/** Marks an item as the AI's pick. It still needs a person to approve it. */
function markPick(table: "ideas" | "copy_variations" | "agent_outputs", id: number) {
  db().prepare(`UPDATE ${table} SET status = 'ai_selected' WHERE id = ?`).run(id);
}

export async function runAutopilot(runId: number) {
  await syncStore();
  const row = db().prepare("SELECT * FROM workflow_runs WHERE id = ?").get(runId) as unknown as RunRow;
  const steps = JSON.parse(row.steps_json) as RunStep[];
  const campaignId = row.campaign_id;
  // Save progress and publish it to the shared store so other functions (the polling page) see it.
  const save = async () => {
    db().prepare("UPDATE workflow_runs SET steps_json = ? WHERE id = ?").run(JSON.stringify(steps), runId);
    await flushStore();
  };
  const step = async (key: string, fn: () => Promise<string>, skipIf?: string | false) => {
    const s = steps.find((x) => x.key === key)!;
    if (skipIf) {
      s.status = "skipped";
      s.detail = skipIf;
      await save();
      return;
    }
    s.status = "running";
    s.started_at = now();
    await save();
    try {
      s.detail = await fn();
      s.status = "done";
    } catch (e) {
      s.status = "failed";
      s.detail = (e as Error).message.slice(0, 300);
    }
    s.finished_at = now();
    await save();
  };

  const cfg = parseSettings(creative.getCampaign(campaignId)?.settings_json);
  const off = "Turned off in AI settings";
  let ideaId = 0;
  let copyId = 0;
  let scriptId = 0;

  await step("ideas", async () => {
    const r = await creative.generateIdeas(campaignId, cfg.ideas);
    const ideas = creative.listIdeas(campaignId).filter((i) => r.ids.includes(i.id));
    const best = ideas.filter((i) => !errorCount(i.warnings_json)).sort((a, b) => b.total_score - a.total_score)[0] ?? ideas[0];
    ideaId = best.id;
    markPick("ideas", best.id);
    return `${ideas.length} ideas. Picked “${best.title}” (score ${Math.round(best.total_score)}).`;
  });

  await step(
    "copy",
    async () => {
      const r = await creative.generateCopy(ideaId, cfg.copy);
      const vs = creative.listCopy(campaignId).filter((v) => r.ids.includes(v.id));
      const best = vs.filter((v) => !errorCount(v.qc_json)).sort((a, b) => warnCount(a.qc_json) - warnCount(b.qc_json))[0] ?? vs[0];
      copyId = best.id;
      markPick("copy_variations", best.id);
      return `${vs.length} versions. Picked “${best.headline}”.`;
    },
    !ideaId && "Needs an idea",
  );

  const agentStep = async (key: "static" | "script" | "ugc" | "edit" | "landing", input: Parameters<typeof agents.generateAgentOutput>[1], blocker: string | false) =>
    step(
      key,
      async () => {
        const r = await agents.generateAgentOutput(key, input);
        const o = agents.getOutput(r.id)!;
        if (key === "script") {
          scriptId = r.id;
          markPick("agent_outputs", r.id);
        }
        const errs = errorCount(o.qc_json);
        return errs ? `Ready, with ${errs} issue(s) to fix` : "Ready for review";
      },
      blocker,
    );

  await agentStep("static", { ideaId, copyId, options: { count: String(cfg.static_concepts) } }, (!cfg.run_static && off) || (!copyId && "Needs ad copy"));
  await agentStep(
    "script",
    { ideaId, options: { format: cfg.script_format, duration: cfg.script_duration, presenter: cfg.script_presenter } },
    (!cfg.run_script && off) || (!ideaId && "Needs an idea"),
  );
  await agentStep("ugc", { scriptId, options: { route: cfg.ugc_route } }, (!cfg.run_ugc && off) || (!scriptId && "Needs a script"));
  await agentStep("edit", { scriptId, options: { style: cfg.edit_style } }, (!cfg.run_edit && off) || (!scriptId && "Needs a script"));
  await agentStep("landing", { ideaId, copyId, options: { length: cfg.landing_length } }, (!cfg.run_landing && off) || (!copyId && "Needs ad copy"));

  const failed = steps.filter((s) => s.status === "failed").length;
  const attempted = steps.filter((s) => s.status !== "skipped").length;
  const status = failed && failed === attempted ? "failed" : failed ? "completed_with_errors" : "completed";
  db().prepare("UPDATE workflow_runs SET status = ?, finished_at = ? WHERE id = ?").run(status, now(), runId);
  audit("autopilot.finish", "campaign", campaignId, `Run #${runId}: ${status}`);
  await flushStore();
  return status;
}

/**
 * The single human gate: approve everything the AI produced for this campaign that is waiting for review,
 * except items with QC errors (those must be fixed first).
 */
export function approveAll(campaignId: number) {
  const waiting = "('pending_review','ai_selected')";
  let approved = 0;
  let blocked = 0;
  // Approves the AI's picks (idea, copy, script) and every agent result; alternatives stay for the reviewer.
  const ideas = db().prepare(`SELECT id, warnings_json FROM ideas WHERE campaign_id = ? AND status IN ${waiting}`).all(campaignId) as { id: number; warnings_json: string }[];
  // Only the AI-picked idea gets approved; the alternatives are left for the reviewer.
  for (const i of ideas) {
    const picked = (db().prepare("SELECT status FROM ideas WHERE id = ?").get(i.id) as { status: string }).status === "ai_selected";
    if (!picked) continue;
    if (errorCount(i.warnings_json)) blocked++;
    else {
      creative.decideIdea(i.id, "approve", "Approved via Approve all");
      approved++;
    }
  }
  const copy = db().prepare(`SELECT id, qc_json, status FROM copy_variations WHERE campaign_id = ? AND is_current = 1 AND status = 'ai_selected'`).all(campaignId) as {
    id: number;
    qc_json: string;
    status: string;
  }[];
  for (const c of copy) {
    if (errorCount(c.qc_json)) blocked++;
    else {
      creative.decideCopy(c.id, "approve", "Approved via Approve all");
      approved++;
    }
  }
  const outs = db().prepare(`SELECT id, qc_json FROM agent_outputs WHERE campaign_id = ? AND status IN ${waiting}`).all(campaignId) as { id: number; qc_json: string }[];
  for (const o of outs) {
    if (errorCount(o.qc_json)) blocked++;
    else {
      agents.decideOutput(o.id, "approve", "Approved via Approve all");
      approved++;
    }
  }
  return { approved, blocked };
}
