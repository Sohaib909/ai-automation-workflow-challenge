import { connection } from "next/server";
import { syncStore } from "@/lib/db";
import { getDb } from "@/lib/db";
import { Badge, Card, PageHeader, fmtDate } from "@/components/ui";

export default async function ActivityPage() {
  await connection();
  await syncStore();
  const db = getDb();
  const audit = db.prepare("SELECT * FROM audit_log ORDER BY id DESC LIMIT 100").all() as {
    id: number;
    actor: string;
    action: string;
    entity_type: string;
    entity_id: number | null;
    detail: string;
    created_at: string;
  }[];
  const logs = db.prepare("SELECT * FROM ai_logs ORDER BY id DESC LIMIT 100").all() as {
    id: number;
    task: string;
    provider: string;
    model: string;
    status: string;
    attempts: number;
    latency_ms: number;
    input_tokens: number | null;
    output_tokens: number | null;
    error: string | null;
    created_at: string;
  }[];
  const usage = db
    .prepare("SELECT provider, model, COUNT(*) calls, SUM(status='failed') failed, SUM(input_tokens) tin, SUM(output_tokens) tout, AVG(latency_ms) lat FROM ai_logs GROUP BY provider, model")
    .all() as { provider: string; model: string; calls: number; failed: number; tin: number | null; tout: number | null; lat: number }[];

  return (
    <>
      <PageHeader title="Activity & AI logs" subtitle="Audit trail of every decision and data change, plus every AI call with provider, latency, tokens and errors." />
      <Card title="AI usage by provider" className="mb-4">
        <div className="overflow-x-auto">
          <table className="tabular w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="py-1">Provider / model</th>
                <th className="text-right">Calls</th>
                <th className="text-right">Failed</th>
                <th className="text-right">Input tokens</th>
                <th className="text-right">Output tokens</th>
                <th className="text-right">Avg latency</th>
              </tr>
            </thead>
            <tbody>
              {usage.map((u) => (
                <tr key={u.provider + u.model} className="border-t border-line">
                  <td className="py-1">
                    {u.provider}/{u.model}
                  </td>
                  <td className="text-right">{u.calls}</td>
                  <td className="text-right">{u.failed}</td>
                  <td className="text-right">{u.tin ?? "—"}</td>
                  <td className="text-right">{u.tout ?? "—"}</td>
                  <td className="text-right">{Math.round(u.lat)} ms</td>
                </tr>
              ))}
              {!usage.length && (
                <tr>
                  <td colSpan={6} className="py-2 text-muted">
                    No AI calls yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="AI calls">
          <ul className="divide-y divide-line text-sm">
            {logs.map((l) => (
              <li key={l.id} className="py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={l.status === "failed" ? "bad" : l.status === "success" ? "good" : "warn"}>{l.status}</Badge>
                  <span className="font-medium">{l.task}</span>
                  <span className="text-xs text-muted">
                    {l.provider}/{l.model} · {l.attempts} attempt(s) · {l.latency_ms} ms · {fmtDate(l.created_at)}
                  </span>
                </div>
                {l.error && <p className="mt-1 text-xs break-words text-bad">{l.error}</p>}
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Audit log">
          <ul className="divide-y divide-line text-sm">
            {audit.map((a) => (
              <li key={a.id} className="flex flex-wrap items-baseline gap-x-2 py-2">
                <Badge>{a.action}</Badge>
                <span className="text-xs text-muted">
                  {a.entity_type}
                  {a.entity_id ? ` #${a.entity_id}` : ""} · {a.actor} · {fmtDate(a.created_at)}
                </span>
                {a.detail && <span className="w-full text-xs text-muted">{a.detail}</span>}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
