/**
 * Integration tests for the two demo flows, against a fresh in-memory SQLite DB and the mock AI provider.
 */
import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import * as creative from "@/lib/creative/service";
import * as analytics from "@/lib/analytics/service";
import * as agents from "@/lib/agents/service";
import { campaignWorkflow } from "@/lib/workflow";
import { SPECS } from "@/lib/agents/specs";
import { generateSampleCsv } from "@/lib/analytics/sample";
import { generateStructured, extractJSON, AIGenerationError } from "@/lib/ai/generate";
import type { LLMProvider } from "@/lib/ai/providers";
import { ProviderError, resolveProvider } from "@/lib/ai/providers";
import { z } from "zod";
import Papa from "papaparse";

import { ensureSampleClients } from "@/lib/schema";
ensureSampleClients(getDb());

const harbour = () => creative.listClients().find((c) => c.name === "Harbour Lights Foundation")!;
// The seed has clients only; tests create their own campaign + brief, the same way a user would in the UI.
let winterId = 0;
const winter = () => {
  if (!winterId) {
    winterId = creative.createCampaign({ client_id: harbour().id, name: "Winter Appeal 2026", objective: "Monthly giving sign-ups", platform: "meta" });
    creative.saveBrief(winterId, {
      product: "Monthly giving at £10/month",
      audience: "UK adults 30–60 who have donated before",
      pain_points: "Feel donations disappear into admin; unsure one person can help",
      offer: "£10/month monthly gift, cancel anytime",
      proof_points: "£25 funds one night of emergency accommodation (sample fact)",
      tone: "Warm, hopeful",
      cta: "Donate Now",
    });
  }
  return creative.getCampaign(winterId)!;
};

describe("Demo A: brief → ideas → approval → copy", () => {
  it("a fresh database is empty; sample clients exist only once loaded", () => {
    expect(creative.listClients()).toHaveLength(3);
    expect(creative.listCampaigns()).toHaveLength(0);
    expect(creative.latestBrief(winter().id)?.version).toBe(1);
  });

  it("requires a brief before generating ideas", async () => {
    const nf = creative.listClients().find((c) => c.name === "Northfield Animal Rescue")!;
    const id = creative.createCampaign({ client_id: nf.id, name: "Foster Carer Drive", objective: "Leads", platform: "meta" });
    await expect(creative.generateIdeas(id, 3)).rejects.toThrow(/brief/i);
  });

  it("generates scored ideas pending review, logged to ai_logs", async () => {
    const r = await creative.generateIdeas(winter().id, 4);
    expect(r.isMock).toBe(true);
    const ideas = creative.listIdeas(winter().id);
    expect(ideas).toHaveLength(4);
    expect(ideas.every((i) => i.status === "pending_review" && i.total_score >= 0 && i.total_score <= 100)).toBe(true);
    expect(JSON.parse(ideas[0].warnings_json).some((w: { code: string }) => w.code === "mock")).toBe(true);
    expect((getDb().prepare("SELECT COUNT(*) n FROM ai_logs WHERE task='idea_generation'").get() as { n: number }).n).toBe(1);
  });

  it("second batch uses fresh lenses", async () => {
    await creative.generateIdeas(winter().id, 4);
    const lenses = creative.listIdeas(winter().id).map((i) => i.lens);
    expect(new Set(lenses).size).toBe(8);
  });

  it("blocks copywriting until the idea is approved (workflow gate)", async () => {
    const idea = creative.listIdeas(winter().id)[0];
    await expect(creative.generateCopy(idea.id, 3)).rejects.toThrow(/approved/);
    creative.decideIdea(idea.id, "approve", "");
    creative.rateIdea(idea.id, 5);
    const r = await creative.generateCopy(idea.id, 3);
    expect(r.ids).toHaveLength(3);
    expect(creative.listCopy(winter().id).every((v) => v.idea_id === idea.id && v.status === "pending_review")).toBe(true);
  });

  it("editing approved copy creates a new version and resets approval", () => {
    const v = creative.listCopy(winter().id)[0];
    creative.decideCopy(v.id, "approve", "Looks good");
    const newId = creative.editCopy(v.id, { headline: "A brand new headline" });
    const versions = creative.copyVersions(v.lineage_id);
    expect(versions.map((x) => x.version)).toEqual([2, 1]);
    expect(versions[0]).toMatchObject({ id: newId, status: "pending_review", is_current: 1, headline: "A brand new headline" });
    expect(versions[1]).toMatchObject({ status: "approved", is_current: 0 });
    expect(() => creative.editCopy(v.id, { headline: "x" })).toThrow(/current version/);
  });

  it("refuses approval while QC errors (banned claims) are present", () => {
    const v = creative.listCopy(winter().id)[0];
    const id = creative.editCopy(v.id, { primary_text: "Help us end homelessness this winter." });
    expect(() => creative.decideCopy(id, "approve", "")).toThrow(/QC errors/);
  });

  it("regenerates a single field as a new version", async () => {
    const v = creative.listCopy(winter().id)[1];
    const id = await creative.regenerateCopyField(v.id, "cta", "");
    const next = creative.copyVersions(v.lineage_id)[0];
    expect(next.id).toBe(id);
    expect(next.cta).not.toBe(v.cta);
    expect(next.headline).toBe(v.headline);
  });

  it("exports only approved, current copy", () => {
    const v = creative.listCopy(winter().id)[2];
    creative.decideCopy(v.id, "approve", "");
    const parsed = Papa.parse<Record<string, string>>(creative.exportApprovedCopyCSV(winter().id), { header: true });
    expect(parsed.data).toHaveLength(1);
    expect(parsed.data[0].id).toBe(String(v.id));
  });

  it("records approvals and audit entries", () => {
    expect((getDb().prepare("SELECT COUNT(*) n FROM approvals").get() as { n: number }).n).toBeGreaterThanOrEqual(3);
    expect((getDb().prepare("SELECT COUNT(*) n FROM audit_log WHERE action LIKE 'approval.%'").get() as { n: number }).n).toBeGreaterThanOrEqual(3);
  });
});

describe("Demo B: CSV → dashboard → recommendations → learnings feed ideas", () => {
  const csv = generateSampleCsv();

  it("imports sample data, maps accounts to clients and runs detection", () => {
    const r = analytics.importCsv(csv, "sample.csv", "sample");
    expect(r.fatal).toBeNull();
    expect(r.inserted).toBe(28 * 9);
    expect(r.newFindings).toBeGreaterThan(4);
  });

  it("rejects re-importing the same file", () => {
    expect(analytics.importCsv(csv, "sample.csv", "upload").fatal).toMatch(/already been imported/);
  });

  it("counts overlapping rows as duplicates and rejects unmapped accounts", () => {
    const lines = csv.trim().split("\n");
    const overlap = [lines[0], lines[1], lines[2].replace("act_1001", "act_9999")].join("\n");
    const r = analytics.importCsv(overlap, "overlap.csv", "upload");
    expect(r.duplicates).toBe(1);
    expect(r.unmappedAccounts).toEqual(["act_9999"]);
    expect(r.inserted).toBe(0);
  });

  it("dashboard filters by client and shows unavailable ROAS for lead-gen", () => {
    const nf = creative.listClients().find((c) => c.name === "Northfield Animal Rescue")!;
    const d = analytics.dashboard({ clientId: nf.id });
    expect(d.clients).toHaveLength(1);
    expect(d.totals.roas).toBeNull();
    expect(d.series).toHaveLength(28);
  });

  it("re-running detection does not duplicate recommendations", () => {
    const before = analytics.listRecommendations().length;
    expect(analytics.runDetection()).toBe(0);
    expect(analytics.listRecommendations().length).toBe(before);
  });

  it("decisions are recorded; approved creative learnings flow into idea generation", async () => {
    const top = analytics.listRecommendations({ clientId: harbour().id }).find((r) => r.rule === "top_creative")!;
    expect(creative.clientLearnings(harbour().id)).toEqual([]);
    analytics.decideRecommendation(top.id, "approve", "Brief more like this");
    const learnings = creative.clientLearnings(harbour().id);
    expect(learnings).toHaveLength(1);
    expect(learnings[0].text).toContain("£25 One Night Carousel");

    await creative.generateIdeas(winter().id, 2);
    const all = creative.listIdeas(winter().id);
    const batch = all.filter((i) => i.batch_id === all[0].batch_id);
    expect(batch.every((i) => JSON.parse(i.learnings_used_json)[0].id === top.id)).toBe(true);
    expect(batch.some((i) => i.rationale.includes("£25 One Night Carousel"))).toBe(true);
    expect(campaignWorkflow(winter().id).stages.find((s) => s.key === "performance")?.state).toBe("done");
  });

  it("AI insight summary only contains figures from the fact sheet", async () => {
    const id = await analytics.generateInsight({});
    const ins = analytics.latestInsight()!;
    expect(ins.id).toBe(id);
    expect(ins.warnings.filter((w) => w.includes("not found in the source"))).toEqual([]);
    expect(analytics.verifyFigures({ ...ins.content, summary: "Spend was £999,999.99" }, analytics.factSheet({}))).toEqual(["999,999.99"]);
  });
});

describe("Production agents (script → UGC/edit, copy → static/landing)", () => {
  it("script needs an approved idea; UGC and edit need an approved script", async () => {
    const pending = creative.listIdeas(winter().id).find((i) => i.status === "pending_review")!;
    await expect(agents.generateAgentOutput("script", { ideaId: pending.id, options: {} })).rejects.toThrow(/approved/);
    const approved = creative.listIdeas(winter().id).find((i) => i.status === "approved")!;
    const s = await agents.generateAgentOutput("script", { ideaId: approved.id, options: { duration: "30", format: "Explainer" } });
    const row = agents.getOutput(s.id)!;
    expect(JSON.parse(row.options_json)).toMatchObject({ duration: "30", format: "Explainer", presenter: "Real creator" });
    expect(SPECS.script.schema.safeParse(JSON.parse(row.content_json)).success).toBe(true);
    await expect(agents.generateAgentOutput("ugc", { scriptId: s.id, options: {} })).rejects.toThrow(/isn't approved/);
    agents.decideOutput(s.id, "approve", "");
    const u = await agents.generateAgentOutput("ugc", { scriptId: s.id, options: { route: "AI presenter (avatar)" } });
    const ugc = agents.getOutput(u.id)!;
    expect(ugc.idea_id).toBe(approved.id);
    expect(JSON.parse(ugc.qc_json).some((f: { code: string }) => f.code === "not_submitted")).toBe(true);
    const e = await agents.generateAgentOutput("edit", { scriptId: s.id, options: {} });
    expect(SPECS.edit.schema.safeParse(JSON.parse(agents.getOutput(e.id)!.content_json)).success).toBe(true);
  });

  it("static creative and landing pages need approved copy", async () => {
    const idea = creative.listIdeas(winter().id).find((i) => i.status === "approved")!;
    await expect(agents.generateAgentOutput("landing", { ideaId: idea.id, options: {} })).rejects.toThrow(/copy/);
    const copy = agents.approvedCopy(winter().id)[0];
    const l = await agents.generateAgentOutput("landing", { ideaId: idea.id, copyId: copy.id, options: {} });
    expect(SPECS.landing.schema.safeParse(JSON.parse(agents.getOutput(l.id)!.content_json)).success).toBe(true);
    const st = await agents.generateAgentOutput("static", { ideaId: idea.id, copyId: copy.id, options: { count: "3" } });
    expect(JSON.parse(agents.getOutput(st.id)!.content_json).concepts).toHaveLength(3);
    agents.decideOutput(st.id, "approve", "");
    agents.decideOutput(l.id, "reject", ""); // reasons are optional
    expect(agents.getOutput(l.id)!.status).toBe("rejected");
  });

  it("the workflow stepper reflects every stage and suggests a next step", () => {
    const wf = campaignWorkflow(winter().id);
    expect(wf.stages.map((s) => s.key)).toEqual(["brief", "ideas", "copy", "static", "script", "ugc", "edit", "landing", "performance"]);
    expect(wf.stages.find((s) => s.key === "static")?.state).toBe("done");
    expect(wf.stages.find((s) => s.key === "ugc")?.state).toBe("review");
    expect(wf.next).not.toBeNull();
  });
});

describe("AI layer", () => {
  const schema = z.object({ ok: z.boolean() });
  const fake = (replies: (string | Error)[]): LLMProvider => {
    let i = 0;
    return {
      id: "gemini",
      model: "fake",
      isMock: false,
      async complete() {
        const r = replies[i++];
        if (r instanceof Error) throw r;
        return { text: r, inputTokens: 10, outputTokens: 5 };
      },
    };
  };
  const call = (p: LLMProvider) => generateStructured({ task: "t", schema, system: "s", prompt: "p", mock: () => ({ ok: true }), provider: p });

  it("parses fenced JSON", () => {
    expect(extractJSON('Sure!\n```json\n{"ok":true}\n```')).toEqual({ ok: true });
  });
  it("retries once on schema-invalid output", async () => {
    expect((await call(fake(['{"ok":"yes"}', '{"ok":true}']))).data).toEqual({ ok: true });
  });
  it("retries retryable transport errors, then fails loudly without falling back to mock", async () => {
    await expect(call(fake([new ProviderError("HTTP 503", true), new ProviderError("HTTP 503", true)]))).rejects.toBeInstanceOf(AIGenerationError);
    await expect(call(fake([new ProviderError("HTTP 401", false)]))).rejects.toThrow(/1 attempt/);
    const failed = getDb().prepare("SELECT COUNT(*) n FROM ai_logs WHERE status='failed'").get() as { n: number };
    expect(failed.n).toBe(2);
  });
  it("selects providers from env and refuses a forced provider without credentials", () => {
    expect(resolveProvider({} as NodeJS.ProcessEnv).id).toBe("mock");
    expect(resolveProvider({ GEMINI_API_KEY: "k" } as never).id).toBe("gemini");
    expect(resolveProvider({ OPENROUTER_API_KEY: "k" } as never).id).toBe("openrouter");
    expect(() => resolveProvider({ AI_PROVIDER: "gemini" } as never)).toThrow(/not configured/);
    // Ollama Cloud takes priority when its key is set
    expect(resolveProvider({ OLLAMA_API_KEY: "k", GEMINI_API_KEY: "g" } as never)).toMatchObject({ id: "ollama", model: "gpt-oss:120b (cloud)" });
    expect(resolveProvider({ OLLAMA_MODEL: "llama3.1:8b" } as never)).toMatchObject({ id: "ollama", model: "llama3.1:8b" });
  });

  it("calls Ollama Cloud's /api/chat with a bearer key and parses the reply", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ message: { content: '{"ok":true}' }, prompt_eval_count: 12, eval_count: 3 }), { status: 200 });
    }) as typeof fetch;
    try {
      const p = resolveProvider({ OLLAMA_API_KEY: "secret-key", OLLAMA_MODEL: "gemma4:31b" } as never);
      const out = await generateStructured({ task: "t", schema, system: "s", prompt: "p", mock: () => ({ ok: false }), provider: p });
      expect(out.data).toEqual({ ok: true });
      expect(calls[0].url).toBe("https://ollama.com/api/chat");
      expect((calls[0].init.headers as Record<string, string>).authorization).toBe("Bearer secret-key");
      expect(JSON.parse(String(calls[0].init.body))).toMatchObject({ model: "gemma4:31b", stream: false, format: "json" });
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe("AI autopilot (one click → whole campaign package → one approval)", () => {
  it("runs every agent, picks the best options, approves nothing on its own, then Approve all", async () => {
    const { startRun, runAutopilot, latestRun, approveAll } = await import("@/lib/autopilot");
    const cid = creative.createCampaign({ client_id: harbour().id, name: "Autopilot test", objective: "Donations", platform: "meta" });
    await expect(async () => startRun(cid)).rejects.toThrow(/brief/);
    creative.saveBrief(cid, { product: "Monthly giving", audience: "UK donors", pain_points: "admin worries", offer: "£10/month", proof_points: "£25 funds one night (sample)", tone: "Warm", cta: "Donate Now" });
    const runId = startRun(cid);
    expect(() => startRun(cid)).toThrow(/already working/);
    const status = await runAutopilot(runId);
    expect(status).toBe("completed");
    const run = latestRun(cid)!;
    expect(run.steps.every((s) => s.status === "done")).toBe(true);

    // Nothing was approved by the AI
    const approvedCount = (getDb().prepare("SELECT COUNT(*) n FROM approvals WHERE entity_id IN (SELECT id FROM ideas WHERE campaign_id = ?) AND entity_type = 'idea'").get(cid) as { n: number }).n;
    expect(approvedCount).toBe(0);
    expect(creative.listIdeas(cid).filter((i) => i.status === "ai_selected")).toHaveLength(1);
    for (const a of ["static", "script", "ugc", "edit", "landing"] as const) expect(agents.listOutputs(a, cid)).toHaveLength(1);

    const r = approveAll(cid);
    expect(r.approved).toBe(1 + 1 + 5); // idea pick + copy pick + 5 agent outputs
    expect(creative.listIdeas(cid).filter((i) => i.status === "pending_review")).toHaveLength(3); // alternatives untouched
  });

  it("regenerate archives the old version and keeps the source", async () => {
    const cid = creative.listCampaigns().find((k) => k.name === "Autopilot test")!.id;
    const old = agents.listOutputs("landing", cid)[0];
    const r = await agents.regenerateOutput(old.id, "shorter");
    expect(agents.getOutput(old.id)!.status).toBe("archived");
    expect(agents.listOutputs("landing", cid).map((o) => o.id)).toEqual([r.id]);
    expect(agents.getOutput(r.id)!.source_copy_id).toBe(old.source_copy_id);
    const copy = creative.listCopy(cid).find((c) => c.status === "approved")!;
    const v2 = await creative.regenerateCopy(copy.id, "");
    expect(creative.copyVersions(copy.lineage_id)[0]).toMatchObject({ id: v2, version: copy.version + 1, status: "pending_review" });
    const idea = creative.listIdeas(cid).find((i) => i.status === "approved")!;
    const newIdea = await creative.regenerateIdea(idea.id, "more practical");
    expect(creative.getIdea(newIdea)!.lens).toBe(idea.lens);
    expect(creative.listIdeas(cid).some((i) => i.id === idea.id)).toBe(false);
    expect(creative.getIdea(newIdea)!.status).toBe("ai_selected");
    await expect(creative.regenerateCopy(v2, "")).rejects.toThrow(/Run the AI again/);
  });
});

describe("AI settings per campaign", () => {
  it("parses form values safely and switches off UGC/edit when the script is off", async () => {
    const { settingsFromForm, DEFAULT_SETTINGS } = await import("@/lib/run-settings");
    const fd = new FormData();
    fd.set("s_present", "1");
    fd.set("s_ideas", "6");
    fd.set("s_copy", "99"); // invalid → default
    fd.set("s_script_duration", "15");
    fd.set("s_run_static", "on");
    fd.set("s_run_landing", "on");
    fd.set("s_run_ugc", "on"); // ignored because the script is off
    const s = settingsFromForm(fd);
    expect(s).toMatchObject({ ideas: 6, copy: DEFAULT_SETTINGS.copy, script_duration: "15", run_static: true, run_script: false, run_ugc: false, run_edit: false, run_landing: true });
    expect(settingsFromForm(new FormData())).toEqual(DEFAULT_SETTINGS); // no settings section → defaults
  });

  it("the autopilot follows the counts, choices and turned-off agents", async () => {
    const { startRun, runAutopilot, latestRun } = await import("@/lib/autopilot");
    const cid = creative.createCampaign({ client_id: harbour().id, name: "Settings test", objective: "Donations", platform: "meta" });
    creative.saveBrief(cid, { product: "Monthly giving", audience: "UK donors", pain_points: "", offer: "£10/month", proof_points: "", tone: "", cta: "Donate Now" });
    creative.saveCampaignSettings(cid, { ideas: 3, copy: 2, static_concepts: 1, script_duration: "15", script_format: "Explainer", run_static: true, run_script: true, run_ugc: false, run_edit: false, run_landing: false });
    expect(await runAutopilot(startRun(cid))).toBe("completed");
    expect(creative.listIdeas(cid)).toHaveLength(3);
    expect(creative.listCopy(cid)).toHaveLength(2);
    expect(JSON.parse(agents.listOutputs("static", cid)[0].content_json).concepts).toHaveLength(1);
    expect(JSON.parse(agents.listOutputs("script", cid)[0].options_json)).toMatchObject({ duration: "15", format: "Explainer" });
    expect(agents.listOutputs("ugc", cid)).toHaveLength(0);
    const steps = latestRun(cid)!.steps;
    expect(steps.filter((s) => s.status === "skipped").map((s) => s.key)).toEqual(["ugc", "edit", "landing"]);
    expect(steps.find((s) => s.key === "landing")!.detail).toBe("Turned off in AI settings");
  });
});
