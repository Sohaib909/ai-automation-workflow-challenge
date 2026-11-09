import Link from "next/link";
import { connection } from "next/server";
import { syncStore } from "@/lib/db";
import { listRecommendations } from "@/lib/analytics/service";
import type { Evidence } from "@/lib/analytics/rules";
import { approvalHistory } from "@/lib/audit";
import { TOOL_NAMES } from "@/lib/tool-names";
import { decideRecommendationAction } from "@/app/actions";
import { ActionForm, Submit } from "@/components/action-form";
import { Badge, Card, Empty, PageHeader, StatusBadge, type Tone, fmtDate } from "@/components/ui";

const SEV: Record<string, [Tone, string]> = {
  high: ["bad", "▲ High"],
  medium: ["warn", "● Medium"],
  low: ["neutral", "Low"],
  positive: ["good", "★ Opportunity"],
};

export default async function MediaBuyerPage({ searchParams }: PageProps<"/media-buyer">) {
  await connection();
  await syncStore();
  const sp = await searchParams;
  const status = typeof sp.status === "string" ? sp.status : "open";
  const recs = listRecommendations({ status: status === "all" ? undefined : status });
  const tabs = ["open", "approved", "rejected", "dismissed", "all"];

  return (
    <>
      <PageHeader
        title={TOOL_NAMES["media-buyer"]}
        subtitle="Monitors imported performance and recommends what to look at, with the numbers behind every alert. A person makes every decision."
      />
      <div className="mb-4 rounded-lg border border-info/40 bg-info-soft p-3 text-sm text-info">
        <strong>Read-only.</strong> This agent is not connected to any ad account. It cannot pause, edit, publish or change budgets. Accepting a recommendation records the
        decision for a media buyer to action in Ads Manager. Accepted creative learnings are passed to the AI Idea Generator for that client.
      </div>
      <nav className="mb-4 flex flex-wrap gap-1" aria-label="Filter by status">
        {tabs.map((t) => (
          <Link
            key={t}
            href={`/media-buyer?status=${t}`}
            aria-current={status === t ? "page" : undefined}
            className={`rounded-md px-3 py-1 text-sm capitalize ${status === t ? "bg-accent-soft font-medium text-accent" : "text-muted hover:bg-surface-2"}`}
          >
            {t}
          </Link>
        ))}
      </nav>
      {recs.length ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {recs.map((r) => {
            const ev = JSON.parse(r.evidence_json) as Evidence[];
            const hist = approvalHistory("recommendation", r.id);
            const [tone, sevLabel] = SEV[r.severity] ?? ["neutral", r.severity];
            return (
              <Card key={r.id}>
                <div className="mb-2 flex flex-wrap items-center gap-1.5">
                  <Badge tone={tone}>{sevLabel}</Badge>
                  <StatusBadge status={r.status} />
                  <Badge title="Based on sample size behind the signal">Confidence: {r.confidence}</Badge>
                  <Badge>{r.rule.replace(/_/g, " ")}</Badge>
                </div>
                <h3 className="font-semibold">{r.title}</h3>
                <p className="text-xs text-muted">
                  {r.client_name} · {r.campaign_name}
                  {r.ad_name && ` · ${r.ad_name}`}
                </p>
                <p className="mt-2 text-sm">{r.detail}</p>
                <div className="mt-2 overflow-x-auto">
                  <table className="tabular w-full text-xs">
                    <thead>
                      <tr className="text-left text-muted">
                        <th className="py-1">Evidence</th>
                        <th className="text-right">Current</th>
                        <th className="text-right">Comparison</th>
                        <th className="text-right">Change</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ev.map((e) => (
                        <tr key={e.metric} className="border-t border-line">
                          <td className="py-1">
                            {e.metric}
                            <div className="text-[10px] text-muted">{e.window}</div>
                          </td>
                          <td className="text-right">{e.current}</td>
                          <td className="text-right">{e.previous ?? "—"}</td>
                          <td className="text-right">{e.change ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-2 text-sm">
                  <strong>Suggested next step:</strong> {r.suggested_action}
                </p>
                {r.learning && (
                  <p className="mt-2 rounded bg-surface-2 p-2 text-xs text-muted">
                    <strong className="text-ink">Creative learning if accepted:</strong> {r.learning}
                  </p>
                )}
                {hist.length > 0 && (
                  <ul className="mt-2 text-xs text-muted">
                    {hist.map((h, i) => (
                      <li key={i}>
                        {fmtDate(h.created_at)}: {h.decision} by {h.reviewer}
                        {h.comment && `: “${h.comment}”`}
                      </li>
                    ))}
                  </ul>
                )}
                {r.status === "open" && (
                  <ActionForm action={decideRecommendationAction} className="mt-3 flex flex-wrap items-end gap-2 border-t border-line pt-3">
                    <input type="hidden" name="rec_id" value={r.id} />
                    <input name="comment" placeholder="Comment (required to reject)" className="min-w-40 flex-1" aria-label="Comment" />
                    <Submit name="decision" value="approve" pending="Saving…">
                      Accept
                    </Submit>
                    <Submit name="decision" value="reject" variant="danger" pending="Saving…">
                      Reject
                    </Submit>
                    <Submit name="decision" value="dismiss" variant="ghost" pending="Saving…">
                      Dismiss
                    </Submit>
                  </ActionForm>
                )}
              </Card>
            );
          })}
        </div>
      ) : (
        <Empty>
          No {status === "all" ? "" : status} recommendations. {status === "open" && <Link href="/toast" className="text-accent">Import ad data</Link>}
        </Empty>
      )}
    </>
  );
}
