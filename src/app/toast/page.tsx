import { TOOL_NAMES } from "@/lib/tool-names";
import Link from "next/link";
import { connection } from "next/server";
import { syncStore } from "@/lib/db";
import * as a from "@/lib/analytics/service";
import { listClients } from "@/lib/creative/service";
import { type Totals, fmt, pctChange } from "@/lib/analytics/metrics";
import { generateInsightAction, importCsvAction, importSampleAction } from "@/app/actions";
import { ActionForm, Submit } from "@/components/action-form";
import { TrendChart } from "@/components/trend-chart";
import { Badge, Card, Empty, PageHeader, ProviderBadge, btn, fmtDate } from "@/components/ui";

export default async function ToastPage({ searchParams }: PageProps<"/toast">) {
  await connection();
  await syncStore();
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const clientId = Number(one("client")) || undefined;
  const from = one("from") || undefined;
  const to = one("to") || undefined;

  const clients = listClients();
  const imports = a.listImports();
  const range = a.dataRange();
  const d = a.dashboard({ clientId, from, to });
  const insight = a.latestInsight(clientId);
  const openRecs = a.listRecommendations({ status: "open", clientId });

  return (
    <>
      <PageHeader
        title={TOOL_NAMES.toast}
        subtitle="All clients' Meta results in one place. Imported numbers are shown as-is; ratios are recalculated from totals; anything missing shows as “—” (unavailable), never 0."
      />

      <div role="note" className="mb-4 flex flex-wrap items-start gap-3 rounded-lg border border-warn/40 bg-warn-soft p-4 text-sm">
        <span className="shrink-0 rounded-full bg-warn px-2.5 py-0.5 text-xs font-semibold text-surface">Coming soon</span>
        <p className="min-w-0 flex-1 text-ink">
          Live connection to client Meta ad accounts is on the way. For now you can explore the dashboard with the sample dataset or by importing a Meta Ads Manager CSV export.
        </p>
      </div>

      {/* Import */}
      <Card title="Import data" className="mb-4" actions={<a href="/api/sample-csv" className="text-sm text-accent">Download sample CSV ↓</a>}>
        <div className="grid gap-4 md:grid-cols-[1fr_auto]">
          <ActionForm action={importCsvAction} className="flex flex-wrap items-end gap-2">
            <label className="min-w-56 flex-1">
              Meta Ads Manager export (.csv, broken down by day)
              <input type="file" name="file" accept=".csv,text/csv" required />
            </label>
            <Submit pending="Importing…">Import CSV</Submit>
          </ActionForm>
          <ActionForm action={importSampleAction} className="flex items-end">
            <Submit pending="Loading…" variant="secondary">
              Load sample dataset (3 clients, 28 days)
            </Submit>
          </ActionForm>
        </div>
        {imports.length > 0 && (
          <details className="mt-3 text-sm">
            <summary className="text-accent">Import history ({imports.length})</summary>
            <table className="tabular mt-2 w-full text-xs">
              <thead>
                <tr className="text-left text-muted">
                  <th className="py-1">When</th>
                  <th>File</th>
                  <th>Source</th>
                  <th className="text-right">Rows</th>
                  <th className="text-right">Imported</th>
                  <th className="text-right">Duplicates</th>
                  <th className="text-right">Rejected</th>
                </tr>
              </thead>
              <tbody>
                {imports.map((i) => (
                  <tr key={i.id} className="border-t border-line">
                    <td className="py-1">{fmtDate(i.imported_at)}</td>
                    <td>{i.filename}</td>
                    <td>{i.source === "sample" ? <Badge tone="warn">Sample data</Badge> : <Badge>Upload</Badge>}</td>
                    <td className="text-right">{i.rows_total}</td>
                    <td className="text-right">{i.rows_inserted}</td>
                    <td className="text-right">{i.rows_duplicate}</td>
                    <td className="text-right">{i.rows_rejected}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        )}
      </Card>

      {!range.min ? (
        <Empty>No ad data yet. Load the sample dataset or import a Meta CSV export.</Empty>
      ) : (
        <>
          {/* Filters */}
          <form className="mb-4 flex flex-wrap items-end gap-2 rounded-lg border border-line bg-surface p-3" method="get">
            <label className="w-56">
              Client
              <select name="client" defaultValue={clientId ?? ""}>
                <option value="">All clients</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="w-40">
              From
              <input type="date" name="from" defaultValue={from ?? ""} min={range.min} max={range.max ?? undefined} />
            </label>
            <label className="w-40">
              To
              <input type="date" name="to" defaultValue={to ?? ""} min={range.min} max={range.max ?? undefined} />
            </label>
            <button className={btn("primary")}>Apply</button>
            <Link href="/toast" className={btn("ghost")}>
              Reset
            </Link>
            <span className="ml-auto text-xs text-muted">
              Showing {d.range.from} → {d.range.to} · data available {range.min} → {range.max}
            </span>
          </form>

          {/* KPIs */}
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
            <Kpi label="Spend" v={fmt.money(d.totals.spend)} k="spend" t={d.totals} p={d.prevTotals} upGood={null} />
            <Kpi label="Impressions" v={fmt.int(d.totals.impressions)} k="impressions" t={d.totals} p={d.prevTotals} upGood={null} />
            <Kpi label="Link clicks" v={fmt.int(d.totals.clicks)} k="clicks" t={d.totals} p={d.prevTotals} upGood />
            <Kpi label="CTR" v={fmt.pct(d.totals.ctr)} k="ctr" t={d.totals} p={d.prevTotals} upGood />
            <Kpi label="CPM" v={fmt.money(d.totals.cpm)} k="cpm" t={d.totals} p={d.prevTotals} upGood={false} />
            <Kpi label="Results" v={fmt.int(d.totals.results)} k="results" t={d.totals} p={d.prevTotals} upGood />
            <Kpi label="Cost per result" v={fmt.money(d.totals.cpr)} k="cpr" t={d.totals} p={d.prevTotals} upGood={false} />
            <Kpi label="ROAS" v={fmt.x(d.totals.roas)} k="roas" t={d.totals} p={d.prevTotals} upGood note={d.totals.roas == null ? "Needs conversion value on every row" : undefined} />
          </div>

          <div className="mb-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
            <Card title="Daily trend">
              <TrendChart data={d.series.map((s) => ({ date: s.date, spend: s.spend, results: s.results, cpr: s.cpr, ctr: s.ctr, roas: s.roas }))} />
            </Card>

            {/* AI summary */}
            <Card title="AI summary">
              <ActionForm action={generateInsightAction} className="mb-3">
                <input type="hidden" name="client_id" value={clientId ?? ""} />
                <input type="hidden" name="from" value={from ?? ""} />
                <input type="hidden" name="to" value={to ?? ""} />
                <Submit pending="Summarising…">{insight ? "Regenerate for this view" : "Generate summary for this view"}</Submit>
              </ActionForm>
              {insight ? (
                <div className="space-y-2 text-sm">
                  <div className="flex flex-wrap gap-1.5">
                    <ProviderBadge provider={insight.provider} model={insight.model} />
                    <Badge>
                      {insight.period_start} → {insight.period_end}
                    </Badge>
                  </div>
                  {insight.warnings.map((w) => (
                    <p key={w} className="rounded bg-warn-soft px-2 py-1 text-xs text-warn">
                      ! {w}
                    </p>
                  ))}
                  <p className="font-semibold">{insight.content.headline}</p>
                  <p className="text-muted">{insight.content.summary}</p>
                  {(
                    [
                      ["Highlights", insight.content.highlights],
                      ["Concerns", insight.content.concerns],
                      ["Next steps", insight.content.next_steps],
                    ] as const
                  ).map(([h, items]) =>
                    items.length ? (
                      <div key={h}>
                        <p className="text-xs font-semibold text-muted uppercase">{h}</p>
                        <ul className="list-disc pl-4">
                          {items.map((x) => (
                            <li key={x}>{x}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null,
                  )}
                  <p className="text-[11px] text-muted">AI-generated analysis of the imported data. Figures are checked against the source. Review before sending to a client.</p>
                </div>
              ) : (
                <p className="text-sm text-muted">The model sees only a fact sheet computed from the imported rows. Any figure it writes that isn&apos;t in that sheet is flagged.</p>
              )}
              {openRecs.length > 0 && (
                <Link href="/media-buyer" className="mt-3 block rounded-md bg-info-soft p-2 text-sm text-info">
                  {openRecs.length} open Media Buyer recommendation{openRecs.length > 1 ? "s" : ""} for this view →
                </Link>
              )}
            </Card>
          </div>

          <Card title="Clients" className="mb-4">
            <MetricTable rows={d.clients.map((c) => ({ key: c.name, label: c.name, href: `/toast?client=${c.client_id}`, ...c }))} />
          </Card>
          <Card title="Campaign comparison" className="mb-4">
            <MetricTable rows={d.campaigns.map((c) => ({ key: c.client + c.campaign, label: c.campaign, sub: `${c.client}${c.result_type ? ` · ${c.result_type}` : ""}`, ...c }))} />
          </Card>
          <Card title="Ads">
            <MetricTable rows={d.ads.map((c) => ({ key: c.campaign + c.ad, label: c.ad, sub: `${c.client} · ${c.campaign}`, ...c })).sort((x, y) => (y.spend ?? 0) - (x.spend ?? 0))} />
          </Card>
        </>
      )}
    </>
  );
}

function Kpi({ label, v, k, t, p, upGood, note }: { label: string; v: string; k: keyof Totals; t: Totals; p: Totals | null; upGood: boolean | null; note?: string }) {
  const chg = p ? pctChange(t[k] as number | null, p[k] as number | null) : null;
  const good = chg == null || upGood == null ? null : chg >= 0 === upGood;
  return (
    <div className="rounded-lg border border-line bg-surface p-3" title={note}>
      <div className="text-xs text-muted">{label}</div>
      <div className="tabular mt-0.5 text-lg font-semibold">{v}</div>
      {chg != null ? (
        <div className={`tabular text-xs ${good == null ? "text-muted" : good ? "text-good" : "text-bad"}`}>
          {chg >= 0 ? "▲" : "▼"} {fmt.change(chg)} <span className="text-muted">vs prior period</span>
        </div>
      ) : (
        <div className="text-xs text-muted">{note ?? "no prior period"}</div>
      )}
    </div>
  );
}

type Row = Totals & { key: string; label: string; sub?: string; href?: string };
function MetricTable({ rows }: { rows: Row[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="tabular w-full min-w-[760px] text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs text-muted">
            <th className="py-2">Name</th>
            {["Spend", "Impr.", "Clicks", "CTR", "CPC", "CPM", "Results", "Cost/result", "ROAS", "Freq."].map((h) => (
              <th key={h} className="py-2 text-right">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-b border-line last:border-0">
              <td className="py-2 pr-3">
                {r.href ? (
                  <Link href={r.href} className="font-medium text-accent">
                    {r.label}
                  </Link>
                ) : (
                  <span className="font-medium">{r.label}</span>
                )}
                {r.sub && <div className="text-xs text-muted">{r.sub}</div>}
              </td>
              <td className="text-right">{fmt.money(r.spend)}</td>
              <td className="text-right">{fmt.int(r.impressions)}</td>
              <td className="text-right">{fmt.int(r.clicks)}</td>
              <td className="text-right">{fmt.pct(r.ctr)}</td>
              <td className="text-right">{fmt.money(r.cpc)}</td>
              <td className="text-right">{fmt.money(r.cpm)}</td>
              <td className="text-right">{fmt.int(r.results)}</td>
              <td className="text-right">{fmt.money(r.cpr)}</td>
              <td className="text-right">{fmt.x(r.roas)}</td>
              <td className="text-right">{fmt.num(r.frequency, 1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
