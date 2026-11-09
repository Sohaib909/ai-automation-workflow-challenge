import Link from "next/link";
import { connection } from "next/server";
import { syncStore } from "@/lib/db";
import { getDb } from "@/lib/db";
import { Badge, Card, PageHeader, fmtDate } from "@/components/ui";

export default async function Overview() {
  await connection();
  await syncStore();
  const db = getDb();
  const n = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  const stats = [
    { label: "Clients", value: n("SELECT COUNT(*) n FROM clients") },
    { label: "Campaigns", value: n("SELECT COUNT(*) n FROM campaigns") },
    { label: "Agent drafts awaiting review", value: n("SELECT COUNT(*) n FROM agent_outputs WHERE status='pending_review'"), href: "/approvals" },
    { label: "Ideas awaiting review", value: n("SELECT COUNT(*) n FROM ideas WHERE status='pending_review'"), href: "/approvals" },
    { label: "Copy awaiting review", value: n("SELECT COUNT(*) n FROM copy_variations WHERE is_current=1 AND status='pending_review'"), href: "/approvals" },
    { label: "Approved copy (ready)", value: n("SELECT COUNT(*) n FROM copy_variations WHERE is_current=1 AND status='approved'") },
    { label: "Open recommendations", value: n("SELECT COUNT(*) n FROM recommendations WHERE status='open'"), href: "/media-buyer" },
    { label: "Ad data rows", value: n("SELECT COUNT(*) n FROM ad_performance"), href: "/toast" },
    { label: "Failed AI calls", value: n("SELECT COUNT(*) n FROM ai_logs WHERE status='failed'"), href: "/activity" },
  ];
  const activity = db.prepare("SELECT * FROM audit_log ORDER BY id DESC LIMIT 8").all() as {
    id: number;
    actor: string;
    action: string;
    detail: string;
    created_at: string;
  }[];

  return (
    <>
      <PageHeader
        title="CerealBox AI Studio"
        subtitle="Nine AI agents working as one campaign workflow. AI drafts, automatic checks catch problems, and a person approves every step."
      />
      <Card title="How it works" className="mb-6">
        <ol className="grid gap-3 text-sm md:grid-cols-3">
          {[
            ["1", "Describe the campaign", "One short form: who it's for, what you're offering, and the facts the AI may use.", "/clients", "New campaign"],
            ["2", "AI builds everything", "AI Idea Generator, AI Copywriting, AI Static Creative, AI Script Writing, AI UGC Video, AI Video Editing and AI Landing Pages run automatically, with checks.", "/clients", "See campaigns"],
            ["3", "You approve once", "Review the package, approve all in one click, or regenerate any piece with a note. Nothing is published automatically.", "/approvals", "Approvals"],
          ].map(([n, t, d, href, cta]) => (
            <li key={n} className="flex flex-col gap-1 rounded-md bg-surface-2 p-3">
              <span className="grid h-6 w-6 place-items-center rounded-full bg-accent text-xs font-bold text-white">{n}</span>
              <span className="font-semibold">{t}</span>
              <span className="flex-1 text-muted">{d}</span>
              <Link href={href} className="text-accent">
                {cta} →
              </Link>
            </li>
          ))}
        </ol>
        <div className="mt-4">
          <Link href="/clients" className="inline-flex rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90">
            ✦ Start a new campaign
          </Link>
        </div>
      </Card>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {stats.map((s) => {
          const inner = (
            <>
              <div className="text-xs text-muted">{s.label}</div>
              <div className="tabular mt-1 text-2xl font-semibold">{s.value.toLocaleString("en-GB")}</div>
            </>
          );
          return s.href ? (
            <Link key={s.label} href={s.href} className="rounded-lg border border-line bg-surface p-3 hover:bg-surface-2">
              {inner}
            </Link>
          ) : (
            <div key={s.label} className="rounded-lg border border-line bg-surface p-3">
              {inner}
            </div>
          );
        })}
      </div>

      <Card title="Recent activity" actions={<Link href="/activity" className="text-sm text-accent">All activity →</Link>}>
        <ul className="divide-y divide-line text-sm">
          {activity.map((a) => (
            <li key={a.id} className="flex flex-wrap items-baseline gap-x-3 py-2">
              <span className="tabular w-28 shrink-0 text-xs text-muted">{fmtDate(a.created_at)}</span>
              <Badge>{a.action}</Badge>
              <span className="min-w-0 flex-1 text-muted">{a.detail}</span>
              <span className="text-xs text-muted">{a.actor}</span>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
