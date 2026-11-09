import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { getDb, now, tx } from "../db";
import { audit, recordApproval } from "../audit";
import { generateStructured } from "../ai/generate";
import { type ParseReport, parseMetaCsv, rowKey } from "./csv";
import { type Totals, addDays, aggregate, daily, fmt, pctChange } from "./metrics";
import { type Finding, type PerfRow, detect } from "./rules";

const db = () => getDb();
export class ImportError extends Error {}

export interface ImportResult {
  importId: number | null;
  filename: string;
  rowsTotal: number;
  inserted: number;
  duplicates: number;
  rejected: ParseReport["rejected"];
  unmappedAccounts: string[];
  columns: ParseReport["columns"];
  newFindings: number;
  fatal: string | null;
}

/**
 * Import pipeline: parse → validate → map ad accounts to clients → insert (row_key dedupe) → detect.
 * Rows for ad accounts that aren't mapped to a client are rejected rather than guessed, so data
 * can never land against the wrong client.
 */
export function importCsv(text: string, filename: string, source: string): ImportResult {
  const fileHash = createHash("sha256").update(text).digest("hex");
  const base = { filename, rowsTotal: 0, inserted: 0, duplicates: 0, rejected: [], unmappedAccounts: [], newFindings: 0, importId: null };
  if (db().prepare("SELECT 1 FROM ad_imports WHERE file_hash = ?").get(fileHash)) {
    return { ...base, columns: { mapped: {}, ignored: [], missingOptional: [] }, fatal: "This exact file has already been imported." };
  }
  const report = parseMetaCsv(text);
  if (report.fatal) return { ...base, columns: report.columns, rejected: report.rejected, fatal: report.fatal };

  const accounts = new Map(
    (db().prepare("SELECT id, client_id, external_id FROM ad_accounts").all() as { id: number; client_id: number; external_id: string }[]).map((a) => [
      a.external_id,
      a,
    ]),
  );
  const unmapped = new Set<string>();
  const rejected = [...report.rejected];
  const total = report.rows.length + report.rejected.length;

  const result = tx(() => {
    const importId = Number(
      db()
        .prepare(
          "INSERT INTO ad_imports (filename, source, file_hash, rows_total, rows_inserted, rows_duplicate, rows_rejected, report_json, imported_at) VALUES (?,?,?,?,0,0,0,'{}',?)",
        )
        .run(filename, source, fileHash, total, now()).lastInsertRowid,
    );
    const ins = db().prepare(
      `INSERT INTO ad_performance (import_id, client_id, ad_account_id, date, campaign_name, ad_set_name, ad_name, spend, impressions, reach, frequency,
        clicks, results, result_type, conversion_value, row_key) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(row_key) DO NOTHING`,
    );
    let inserted = 0;
    let duplicates = 0;
    report.rows.forEach((r) => {
      const acct = accounts.get(r.account_id);
      if (!acct) {
        unmapped.add(r.account_id);
        return;
      }
      const res = ins.run(importId, acct.client_id, acct.id, r.date, r.campaign_name, r.ad_set_name, r.ad_name, r.spend, r.impressions, r.reach, r.frequency, r.clicks, r.results, r.result_type, r.conversion_value, rowKey(r));
      if (res.changes) inserted++;
      else duplicates++;
    });
    const unmappedRows = report.rows.filter((r) => unmapped.has(r.account_id)).length;
    if (unmappedRows) rejected.push({ line: 0, errors: [`${unmappedRows} row(s) for unmapped ad account(s): ${[...unmapped].join(", ")}`] });
    db()
      .prepare("UPDATE ad_imports SET rows_inserted = ?, rows_duplicate = ?, rows_rejected = ?, report_json = ? WHERE id = ?")
      .run(inserted, duplicates, report.rejected.length + unmappedRows, JSON.stringify({ columns: report.columns, rejected: rejected.slice(0, 50), currency: report.currency }), importId);
    return { importId, inserted, duplicates };
  });

  audit("data.import", "ad_import", result.importId, `${filename}: ${result.inserted} inserted, ${result.duplicates} duplicates, ${rejected.length} rejection groups`);
  const newFindings = result.inserted ? runDetection() : 0;
  return {
    ...base,
    importId: result.importId,
    rowsTotal: total,
    inserted: result.inserted,
    duplicates: result.duplicates,
    rejected,
    unmappedAccounts: [...unmapped],
    columns: report.columns,
    newFindings,
    fatal: null,
  };
}

export function listImports() {
  return db().prepare("SELECT * FROM ad_imports ORDER BY id DESC").all() as {
    id: number;
    filename: string;
    source: string;
    rows_total: number;
    rows_inserted: number;
    rows_duplicate: number;
    rows_rejected: number;
    imported_at: string;
  }[];
}

/* ---------- Queries ---------- */
export interface Filters {
  clientId?: number;
  from?: string;
  to?: string;
}

export function perfRows(f: Filters = {}) {
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (f.clientId) {
    where.push("p.client_id = ?");
    args.push(f.clientId);
  }
  if (f.from) {
    where.push("p.date >= ?");
    args.push(f.from);
  }
  if (f.to) {
    where.push("p.date <= ?");
    args.push(f.to);
  }
  return db()
    .prepare(
      `SELECT p.*, c.name AS client_name FROM ad_performance p JOIN clients c ON c.id = p.client_id ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY p.date`,
    )
    .all(...args) as unknown as (PerfRow & { client_name: string; ad_set_name: string; result_type: string | null })[];
}

export function dataRange(): { min: string | null; max: string | null } {
  return db().prepare("SELECT MIN(date) AS min, MAX(date) AS max FROM ad_performance").get() as { min: string | null; max: string | null };
}

export function dashboard(f: Filters) {
  const rows = perfRows(f);
  const range = { from: f.from ?? rows[0]?.date ?? null, to: f.to ?? rows.at(-1)?.date ?? null };
  // Comparison period: same length immediately before the selected range.
  let prevTotals: Totals | null = null;
  if (range.from && range.to) {
    const len = Math.round((Date.parse(range.to) - Date.parse(range.from)) / 86_400_000) + 1;
    prevTotals = aggregate(perfRows({ clientId: f.clientId, from: addDays(range.from, -len), to: addDays(range.from, -1) }));
    if (!prevTotals.rows) prevTotals = null;
  }
  const by = <K extends string>(key: (r: (typeof rows)[number]) => K) => {
    const m = new Map<K, typeof rows>();
    for (const r of rows) m.set(key(r), [...(m.get(key(r)) ?? []), r]);
    return m;
  };
  const clients = [...by((r) => r.client_name)].map(([name, rs]) => ({ name, client_id: rs[0].client_id, ...aggregate(rs) }));
  const campaigns = [...by((r) => `${r.client_name}\u0000${r.campaign_name}`)].map(([k, rs]) => {
    const [client, campaign] = k.split("\u0000");
    return { client, campaign, result_type: rs.find((r) => r.result_type)?.result_type ?? null, ...aggregate(rs) };
  });
  const ads = [...by((r) => `${r.campaign_name}\u0000${r.ad_name}`)].map(([k, rs]) => {
    const [campaign, ad] = k.split("\u0000");
    return { campaign, ad, client: rs[0].client_name, ...aggregate(rs) };
  });
  return { range, totals: aggregate(rows), prevTotals, clients, campaigns, ads, series: daily(rows), rowCount: rows.length };
}

/* ---------- Detection & recommendations ---------- */
export function runDetection(): number {
  const findings = detect(perfRows());
  const ins = db().prepare(
    `INSERT INTO recommendations (client_id, campaign_name, ad_name, rule, severity, title, detail, evidence_json, suggested_action, confidence, learning, fingerprint, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(fingerprint) DO NOTHING`,
  );
  let n = 0;
  tx(() => {
    for (const f of findings) {
      n += Number(
        ins.run(f.client_id, f.campaign_name, f.ad_name, f.rule, f.severity, f.title, f.detail, JSON.stringify(f.evidence), f.suggested_action, f.confidence, f.learning, f.fingerprint, now()).changes,
      );
    }
  });
  if (n) audit("media_buyer.detect", "recommendation", null, `${n} new finding(s)`);
  return n;
}

export interface RecommendationRow extends Omit<Finding, "evidence"> {
  id: number;
  evidence_json: string;
  status: string;
  created_at: string;
  client_name: string;
}

export function listRecommendations(f: { status?: string; clientId?: number } = {}) {
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (f.status) {
    where.push("r.status = ?");
    args.push(f.status);
  }
  if (f.clientId) {
    where.push("r.client_id = ?");
    args.push(f.clientId);
  }
  return db()
    .prepare(
      `SELECT r.*, c.name AS client_name FROM recommendations r JOIN clients c ON c.id = r.client_id ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY CASE r.status WHEN 'open' THEN 0 ELSE 1 END, CASE r.severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 WHEN 'low' THEN 2 ELSE 3 END, r.id DESC`,
    )
    .all(...args) as unknown as RecommendationRow[];
}

const REC_DECISIONS = { approve: "approved", reject: "rejected", dismiss: "dismissed" } as const;

/**
 * Recording a decision NEVER touches an ad platform — the agent is read-only. "Approved" means a human
 * accepts the recommendation and will action it themselves; approved creative learnings flow into the
 * Idea Generator for that client.
 */
export function decideRecommendation(id: number, decision: keyof typeof REC_DECISIONS, comment: string) {
  const row = db().prepare("SELECT status FROM recommendations WHERE id = ?").get(id) as { status: string } | undefined;
  if (!row) throw new ImportError("Recommendation not found");
  db().prepare("UPDATE recommendations SET status = ? WHERE id = ?").run(REC_DECISIONS[decision], id);
  recordApproval("recommendation", id, REC_DECISIONS[decision], comment);
}

/* ---------- AI insight summary ---------- */
export const InsightSchema = z.object({
  headline: z.string().min(5).max(160),
  summary: z.string().min(20).max(1200),
  highlights: z.array(z.string().min(3).max(300)).max(5),
  concerns: z.array(z.string().min(3).max(300)).max(5),
  next_steps: z.array(z.string().min(3).max(300)).max(5),
});
export type Insight = z.infer<typeof InsightSchema>;

/** Build the only data the model is allowed to see: computed numbers, pre-formatted. */
export function factSheet(f: Filters) {
  const d = dashboard(f);
  const recs = listRecommendations({ clientId: f.clientId }).filter((r) => r.status !== "dismissed" && r.status !== "rejected").slice(0, 8);
  const t = d.totals;
  const p = d.prevTotals;
  return {
    period: `${d.range.from} to ${d.range.to}`,
    totals: {
      spend: fmt.money(t.spend),
      impressions: fmt.int(t.impressions),
      clicks: fmt.int(t.clicks),
      results: fmt.int(t.results),
      ctr: fmt.pct(t.ctr),
      cpc: fmt.money(t.cpc),
      cpm: fmt.money(t.cpm),
      cost_per_result: fmt.money(t.cpr),
      roas: t.roas == null ? "unavailable (conversion value not fully reported)" : fmt.x(t.roas),
    },
    change_vs_previous_period: p
      ? { spend: fmt.change(pctChange(t.spend, p.spend)), results: fmt.change(pctChange(t.results, p.results)), cost_per_result: fmt.change(pctChange(t.cpr, p.cpr)), ctr: fmt.change(pctChange(t.ctr, p.ctr)) }
      : "no previous-period data",
    campaigns: d.campaigns.map((c) => ({
      client: c.client,
      campaign: c.campaign,
      spend: fmt.money(c.spend),
      results: `${fmt.int(c.results)} ${c.result_type ?? ""}`.trim(),
      cost_per_result: fmt.money(c.cpr),
      ctr: fmt.pct(c.ctr),
      roas: c.roas == null ? "unavailable" : fmt.x(c.roas),
    })),
    detected_findings: recs.map((r) => ({ severity: r.severity, title: r.title, detail: r.detail, status: r.status })),
    range: d.range,
  };
}

/** Flags any figure in the AI text that doesn't appear in the fact sheet — a hallucination check. */
export function verifyFigures(insight: Insight, facts: unknown): string[] {
  const factText = JSON.stringify(facts);
  const factNums = new Set((factText.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => n.replace(/,/g, "")));
  const text = [insight.headline, insight.summary, ...insight.highlights, ...insight.concerns, ...insight.next_steps].join(" ");
  const bad = new Set<string>();
  for (const m of text.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const n = m[0].replace(/,/g, "");
    if (n.length <= 1 || /^20\d\d$/.test(n)) continue; // single digits and years are not metrics
    if (!factNums.has(n)) bad.add(m[0]);
  }
  return [...bad];
}

const INSIGHT_SYSTEM = `You are a senior paid-social analyst writing for an agency client.
Use ONLY the numbers in the FACT SHEET, quoted exactly as written. Never calculate new figures, never estimate, never invent causes as facts —
present causes as hypotheses to check. If a metric is unavailable, say so. Plain British English, no jargon without explanation.
Reply with JSON only: {"headline":"","summary":"","highlights":[],"concerns":[],"next_steps":[]}`;

export async function generateInsight(f: Filters) {
  const facts = factSheet(f);
  if (!facts.range.from) throw new ImportError("No performance data in this range. Import a CSV first.");
  const out = await generateStructured({
    task: "performance_insight",
    schema: InsightSchema,
    system: INSIGHT_SYSTEM,
    prompt: `FACT SHEET:\n${JSON.stringify(facts, null, 2)}`,
    temperature: 0.3,
    mock: () => ({
      headline: `${facts.totals.results} results from ${facts.totals.spend} spend (${facts.period})`,
      summary: `Across the selected period, spend was ${facts.totals.spend} for ${facts.totals.results} results at ${facts.totals.cost_per_result} per result and a CTR of ${facts.totals.ctr}. ${
        facts.detected_findings.length ? `${facts.detected_findings.length} finding(s) were detected by the monitoring rules.` : "No issues were detected by the monitoring rules."
      }`,
      highlights: facts.detected_findings.filter((x) => x.severity === "positive").map((x) => `${x.title} — ${x.detail}`).slice(0, 3),
      concerns: facts.detected_findings.filter((x) => x.severity !== "positive").map((x) => `${x.title} — ${x.detail}`).slice(0, 4),
      next_steps: ["Review open Media Buyer recommendations and record a decision for each.", "Brief new creative variations on the strongest-performing angle."],
    }),
  });
  const unverified = verifyFigures(out.data, facts);
  const warnings = [
    ...(unverified.length ? [`Contains figure(s) not found in the source data: ${unverified.join(", ")} — verify before sharing.`] : []),
    ...(out.isMock ? ["Mock provider: template summary, not AI-generated."] : []),
  ];
  const id = Number(
    db()
      .prepare("INSERT INTO insights (client_id, period_start, period_end, content_json, warnings_json, provider, model, created_at) VALUES (?,?,?,?,?,?,?,?)")
      .run(f.clientId ?? null, facts.range.from, facts.range.to, JSON.stringify(out.data), JSON.stringify(warnings), out.provider, out.model, now()).lastInsertRowid,
  );
  audit("insight.generate", "insight", id, `${out.provider}/${out.model}`);
  return id;
}

export function latestInsight(clientId?: number) {
  const row = db()
    .prepare(`SELECT * FROM insights WHERE ${clientId ? "client_id = ?" : "client_id IS NULL"} ORDER BY id DESC LIMIT 1`)
    .get(...(clientId ? [clientId] : [])) as
    | { id: number; period_start: string; period_end: string; content_json: string; warnings_json: string; provider: string; model: string; created_at: string }
    | undefined;
  return row ? { ...row, content: JSON.parse(row.content_json) as Insight, warnings: JSON.parse(row.warnings_json) as string[] } : null;
}
