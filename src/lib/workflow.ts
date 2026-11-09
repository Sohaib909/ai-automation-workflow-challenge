import "server-only";
import { getDb } from "./db";
import { getCampaign, latestBrief } from "./creative/service";
import { TOOL_NAMES, type ToolKey } from "./tool-names";

/**
 * End-to-end campaign workflow: one place that knows every stage, what it needs,
 * and what the user should do next.
 */
export type StageState = "done" | "review" | "ready" | "waiting";

export interface Stage {
  key: string;
  label: string;
  agent: string;
  href: string;
  state: StageState;
  detail: string;
  needs: string;
}

export function campaignWorkflow(campaignId: number): { stages: Stage[]; next: Stage | null } {
  const k = getCampaign(campaignId)!;
  const d = getDb();
  const n = (sql: string, ...a: (number | string)[]) => (d.prepare(sql).get(...a) as { n: number }).n;
  const out = (agent: string, status?: string) =>
    n(`SELECT COUNT(*) n FROM agent_outputs WHERE campaign_id = ? AND agent = ?${status ? " AND status = ?" : ""}`, ...(status ? [campaignId, agent, status] : [campaignId, agent]));

  const brief = !!latestBrief(campaignId);
  const ideasAll = n("SELECT COUNT(*) n FROM ideas WHERE campaign_id = ?", campaignId);
  const ideasOk = n("SELECT COUNT(*) n FROM ideas WHERE campaign_id = ? AND status = 'approved'", campaignId);
  const copyAll = n("SELECT COUNT(*) n FROM copy_variations WHERE campaign_id = ? AND is_current = 1", campaignId);
  const copyOk = n("SELECT COUNT(*) n FROM copy_variations WHERE campaign_id = ? AND is_current = 1 AND status = 'approved'", campaignId);
  const scriptOk = out("script", "approved");
  const learnings = n("SELECT COUNT(*) n FROM recommendations WHERE client_id = ? AND status = 'approved' AND learning IS NOT NULL", k.client_id);
  const perfRows = n("SELECT COUNT(*) n FROM ad_performance WHERE client_id = ?", k.client_id);

  const st = (ok: number, all: number, ready: boolean): StageState => (ok > 0 ? "done" : all > 0 ? "review" : ready ? "ready" : "waiting");
  const agentStage = (key: string, label: string, ready: boolean, needs: string): Stage => {
    const ok = out(key, "approved");
    const all = out(key);
    return {
      key,
      label,
      agent: TOOL_NAMES[key as ToolKey] ?? label,
      href: `/agents/${key}?campaign=${campaignId}`,
      state: st(ok, all, ready),
      detail: all ? `${ok} approved of ${all}` : ready ? "Ready to generate" : `Needs ${needs}`,
      needs,
    };
  };

  const stages: Stage[] = [
    { key: "brief", label: "Brief", agent: "You", href: "#brief", state: brief ? "done" : "ready", detail: brief ? `v${latestBrief(campaignId)!.version} saved` : "Fill in the brief", needs: "" },
    {
      key: "ideas",
      label: "Ideas",
      agent: TOOL_NAMES.ideas,
      href: "#ideas",
      state: st(ideasOk, ideasAll, brief),
      detail: ideasAll ? `${ideasOk} approved of ${ideasAll}` : brief ? "Ready to generate" : "Needs a brief",
      needs: "a brief",
    },
    {
      key: "copy",
      label: "Ad copy",
      agent: TOOL_NAMES.copy,
      href: "#copy",
      state: st(copyOk, copyAll, ideasOk > 0),
      detail: copyAll ? `${copyOk} approved of ${copyAll}` : ideasOk ? "Ready to generate" : "Needs an approved idea",
      needs: "an approved idea",
    },
    agentStage("static", "Static creative", copyOk > 0, "approved copy"),
    agentStage("script", "Video script", ideasOk > 0, "an approved idea"),
    agentStage("ugc", "UGC video", scriptOk > 0, "an approved script"),
    agentStage("edit", "Video edit", scriptOk > 0, "an approved script"),
    agentStage("landing", "Landing page", copyOk > 0, "approved copy"),
    {
      key: "performance",
      label: "Performance",
      agent: `Toast + ${TOOL_NAMES["media-buyer"]}`,
      href: `/toast?client=${k.client_id}`,
      state: learnings ? "done" : perfRows ? "review" : "ready",
      detail: learnings ? `${learnings} learning(s) feeding ideas` : perfRows ? "Data imported — review recommendations" : "Import ad results",
      needs: "",
    },
  ];
  const next = stages.find((s) => s.state === "review") ?? stages.find((s) => s.state === "ready") ?? null;
  return { stages, next };
}
