/**
 * Metric definitions. Base metrics are summed; ratios are always recomputed from the sums
 * (never averaged), and return null when an input is missing or the denominator is zero.
 * Documented in docs/WORKFLOWS.md#metric-definitions.
 */

export interface FactRow {
  date: string;
  spend: number | null;
  impressions: number | null;
  reach: number | null;
  frequency: number | null;
  clicks: number | null;
  results: number | null;
  conversion_value: number | null;
}

export interface Totals {
  spend: number | null;
  impressions: number | null;
  clicks: number | null;
  results: number | null;
  conversion_value: number | null;
  ctr: number | null; // clicks / impressions
  cpc: number | null; // spend / clicks
  cpm: number | null; // spend / impressions × 1000
  cpr: number | null; // spend / results (cost per result)
  roas: number | null; // conversion_value / spend
  frequency: number | null; // impression-weighted mean of daily frequency (reach is not additive across days)
  rows: number;
}

/** Sum that returns null if *every* value is missing; if some are missing the sum is partial (flagged by coverage). */
function sum(rows: FactRow[], k: keyof FactRow): { value: number | null; coverage: number } {
  let s = 0;
  let n = 0;
  for (const r of rows) {
    const v = r[k];
    if (typeof v === "number") {
      s += v;
      n++;
    }
  }
  return { value: n ? s : null, coverage: rows.length ? n / rows.length : 0 };
}

export const ratio = (a: number | null, b: number | null, mult = 1) => (a == null || b == null || b === 0 ? null : (a / b) * mult);

export function aggregate(rows: FactRow[]): Totals & { coverage: Record<string, number> } {
  const spend = sum(rows, "spend");
  const impressions = sum(rows, "impressions");
  const clicks = sum(rows, "clicks");
  const results = sum(rows, "results");
  const value = sum(rows, "conversion_value");
  let fw = 0;
  let fi = 0;
  for (const r of rows) {
    if (r.frequency != null && r.impressions) {
      fw += r.frequency * r.impressions;
      fi += r.impressions;
    }
  }
  return {
    spend: spend.value,
    impressions: impressions.value,
    clicks: clicks.value,
    results: results.value,
    conversion_value: value.value,
    ctr: ratio(clicks.value, impressions.value),
    cpc: ratio(spend.value, clicks.value),
    cpm: ratio(spend.value, impressions.value, 1000),
    cpr: ratio(spend.value, results.value),
    roas: value.coverage === 1 ? ratio(value.value, spend.value) : null, // partial value data would understate ROAS
    frequency: fi ? fw / fi : null,
    rows: rows.length,
    coverage: { clicks: clicks.coverage, results: results.coverage, conversion_value: value.coverage, reach: sum(rows, "reach").coverage },
  };
}

export const pctChange = (cur: number | null, prev: number | null) => (cur == null || prev == null || prev === 0 ? null : (cur - prev) / prev);

export function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daily<T extends FactRow>(rows: T[]): (Totals & { date: string })[] {
  const by = new Map<string, T[]>();
  for (const r of rows) by.set(r.date, [...(by.get(r.date) ?? []), r]);
  return [...by.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, rs]) => ({ date, ...aggregate(rs) }));
}

/* Formatting helpers shared by UI and AI-summary fact sheet */
export const fmt = {
  money: (v: number | null, cur = "£") => (v == null ? "—" : `${cur}${v.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`),
  int: (v: number | null) => (v == null ? "—" : Math.round(v).toLocaleString("en-GB")),
  pct: (v: number | null, dp = 2) => (v == null ? "—" : `${(v * 100).toFixed(dp)}%`),
  x: (v: number | null) => (v == null ? "—" : `${v.toFixed(2)}x`),
  num: (v: number | null, dp = 2) => (v == null ? "—" : v.toFixed(dp)),
  change: (v: number | null) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(0)}%`),
};
