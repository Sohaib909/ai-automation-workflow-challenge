import { syncStore } from "@/lib/db";
import { exportApprovedCopyCSV, getCampaign } from "@/lib/creative/service";

export async function GET(_req: Request, ctx: RouteContext<"/campaigns/[id]/export">) {
  await syncStore();
  const { id } = await ctx.params;
  const campaign = getCampaign(Number(id));
  if (!campaign) return new Response("Campaign not found", { status: 404 });
  const name = campaign.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  return new Response(exportApprovedCopyCSV(campaign.id), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}-approved-copy.csv"` },
  });
}
