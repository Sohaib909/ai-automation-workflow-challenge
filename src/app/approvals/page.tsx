import Link from "next/link";
import { connection } from "next/server";
import { syncStore } from "@/lib/db";
import { getDb } from "@/lib/db";
import { Badge, Card, Empty, PageHeader, StatusBadge, fmtDate } from "@/components/ui";

const AGENT_LABEL: Record<string, string> = { script: "Script", static: "Static creative", ugc: "UGC pack", edit: "Edit plan", landing: "Landing page" };

export default async function ApprovalsPage() {
  await connection();
  await syncStore();
  const db = getDb();
  const pending = db
    .prepare(
      `SELECT * FROM (SELECT 'Idea' AS type, i.id AS id, i.title AS label, i.status AS status, i.campaign_id AS campaign_id, k.name AS campaign, c.name AS client, i.created_at AS created_at
         FROM ideas i JOIN campaigns k ON k.id = i.campaign_id JOIN clients c ON c.id = k.client_id
        WHERE i.status IN ('ai_selected','changes_requested')
       UNION ALL
       SELECT 'Copy', v.id, v.headline || ' (' || v.angle || ', v' || v.version || ')', v.status, v.campaign_id, k.name, c.name, v.created_at
         FROM copy_variations v JOIN campaigns k ON k.id = v.campaign_id JOIN clients c ON c.id = k.client_id
        WHERE v.is_current = 1 AND v.status IN ('ai_selected','pending_review','changes_requested')
       UNION ALL
       SELECT o.agent, o.id, 'From idea: ' || i.title, o.status, o.campaign_id, k.name, c.name, o.created_at
         FROM agent_outputs o JOIN ideas i ON i.id = o.idea_id JOIN campaigns k ON k.id = o.campaign_id JOIN clients c ON c.id = k.client_id
        WHERE o.status IN ('ai_selected','pending_review','changes_requested')
       ) ORDER BY created_at DESC LIMIT 200`,
    )
    .all() as { type: string; id: number; label: string; status: string; campaign_id: number; campaign: string; client: string; created_at: string }[];
  const decisions = db.prepare("SELECT * FROM approvals ORDER BY id DESC LIMIT 30").all() as {
    id: number;
    entity_type: string;
    entity_id: number;
    decision: string;
    reviewer: string;
    comment: string;
    created_at: string;
  }[];

  return (
    <>
      <PageHeader
        title="Approvals queue"
        subtitle="Everything the AI produced that is waiting for your OK. Open a campaign to approve it all in one click."
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Card title={`Waiting for review · ${pending.length}`}>
          {pending.length ? (
            <ul className="divide-y divide-line">
              {pending.map((p) => (
                <li key={`${p.type}-${p.id}`}>
                  <Link href={`/campaigns/${p.campaign_id}`} className="flex flex-wrap items-center gap-2 px-1 py-2 text-sm hover:bg-surface-2">
                    <Badge tone={p.type === "Idea" ? "accent" : "info"}>{AGENT_LABEL[p.type] ?? p.type}</Badge>
                    <span className="min-w-0 flex-1 font-medium">{p.label}</span>
                    <StatusBadge status={p.status} />
                    <span className="w-full text-xs text-muted">
                      {p.client} · {p.campaign} · {fmtDate(p.created_at)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>Nothing waiting. Generate ideas or copy in a campaign.</Empty>
          )}
        </Card>
        <Card title="Recent decisions">
          {decisions.length ? (
            <ul className="space-y-2 text-sm">
              {decisions.map((d) => (
                <li key={d.id} className="flex flex-wrap gap-x-2">
                  <StatusBadge status={d.decision} />
                  <span>
                    {d.entity_type.replace("_", " ")} #{d.entity_id}
                  </span>
                  <span className="text-xs text-muted">
                    {d.reviewer} · {fmtDate(d.created_at)}
                  </span>
                  {d.comment && <span className="w-full text-xs text-muted">“{d.comment}”</span>}
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No decisions yet.</Empty>
          )}
        </Card>
      </div>
    </>
  );
}
