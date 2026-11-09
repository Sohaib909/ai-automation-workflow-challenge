import "server-only";
import { getDb } from "./db";
import * as creative from "./creative/service";
import * as agents from "./agents/service";
import type { EditOut, LandingOut, ScriptOut, StaticOut, UgcOut } from "./agents/specs";
import { withLiveImages } from "./images";

/**
 * Preview: only what a person has APPROVED for a campaign, shaped for showing how the campaign will look
 * live. AI picks still waiting for review are counted but never shown here.
 */

const latestApproved = (agent: agents.AgentOutputRow["agent"], campaignId: number) => agents.listOutputs(agent, campaignId).find((o) => o.status === "approved");

export function campaignPreview(campaignId: number) {
  const campaign = creative.getCampaign(campaignId);
  if (!campaign) return null;
  const client = creative.getClient(campaign.client_id)!;
  const brief = creative.latestBrief(campaignId);
  const ideas = creative.listIdeas(campaignId).filter((i) => i.status === "approved");
  const copy = creative.listCopy(campaignId).filter((c) => c.status === "approved");

  const staticRow = latestApproved("static", campaignId);
  const scriptRow = latestApproved("script", campaignId);
  const ugcRow = latestApproved("ugc", campaignId);
  const editRow = latestApproved("edit", campaignId);
  const landingRow = latestApproved("landing", campaignId);
  const parse = <T,>(row?: agents.AgentOutputRow) => (row ? (JSON.parse(row.content_json) as T) : null);

  // The ad copy that pairs with the images: the copy the static concepts were designed from, if approved.
  const adCopy = copy.find((c) => c.id === staticRow?.source_copy_id) ?? copy[0] ?? null;
  const waiting = waitingCount(campaignId);
  const approvedCount = ideas.length + copy.length + [staticRow, scriptRow, ugcRow, editRow, landingRow].filter(Boolean).length;

  return {
    campaign,
    client,
    brief,
    idea: ideas[0] ?? null,
    copy,
    adCopy,
    statics: staticRow ? withLiveImages(parse<StaticOut>(staticRow)!) : null,
    script: parse<ScriptOut>(scriptRow),
    ugc: parse<UgcOut>(ugcRow),
    edit: parse<EditOut>(editRow),
    landing: parse<LandingOut>(landingRow),
    approvedCount,
    waiting,
  };
}
export type CampaignPreview = NonNullable<ReturnType<typeof campaignPreview>>;

function waitingCount(campaignId: number) {
  return (
    getDb()
      .prepare(
        `SELECT (SELECT COUNT(*) FROM ideas WHERE campaign_id = ?1 AND status IN ('ai_selected','pending_review'))
              + (SELECT COUNT(*) FROM copy_variations WHERE campaign_id = ?1 AND is_current = 1 AND status = 'ai_selected')
              + (SELECT COUNT(*) FROM agent_outputs WHERE campaign_id = ?1 AND status IN ('pending_review','ai_selected')) AS n`,
      )
      .get(campaignId) as { n: number }
  ).n;
}

/** Campaigns with at least one approved item, newest first, with a cover image when one exists. */
export function previewableCampaigns() {
  return creative
    .listCampaigns()
    .map((k) => {
      const p = campaignPreview(k.id)!;
      const cover = p.statics?.concepts.find((c) => c.images?.square)?.images?.square ?? null;
      return { id: k.id, name: k.name, client: k.client_name, objective: k.objective, approved: p.approvedCount, waiting: p.waiting, cover, headline: p.adCopy?.headline ?? p.idea?.title ?? "" };
    })
    .filter((k) => k.approved > 0);
}
