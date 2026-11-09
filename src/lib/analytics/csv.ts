import Papa from "papaparse";

/**
 * Meta Ads Manager CSV → normalized daily rows.
 * Column names vary by export settings and currency, so each canonical field has aliases.
 * Missing/blank cells become null (never 0) so "unavailable" stays distinguishable from "zero".
 */

export interface NormalizedRow {
  date: string;
  account_id: string;
  account_name: string | null;
  campaign_name: string;
  ad_set_name: string;
  ad_name: string;
  spend: number | null;
  impressions: number | null;
  reach: number | null;
  frequency: number | null;
  clicks: number | null;
  results: number | null;
  result_type: string | null;
  conversion_value: number | null;
}

type Field = keyof NormalizedRow;

const ALIASES: Record<Field, RegExp> = {
  date: /^(day|date|reporting starts)$/i,
  account_id: /^(account id|ad account id)$/i,
  account_name: /^(account name|ad account name)$/i,
  campaign_name: /^campaign name$/i,
  ad_set_name: /^ad set name$/i,
  ad_name: /^ad name$/i,
  spend: /^amount spent( \([A-Z]{3}\))?$|^spend$/i,
  impressions: /^impressions$/i,
  reach: /^reach$/i,
  frequency: /^frequency$/i,
  clicks: /^(link clicks|clicks \(all\)|clicks)$/i,
  results: /^results$/i,
  result_type: /^(result indicator|result type)$/i,
  conversion_value: /^(conversion value|purchases conversion value|purchase conversion value|donation value)$/i,
};

export const REQUIRED: Field[] = ["date", "account_id", "campaign_name", "spend", "impressions"];
const INTEGER: Field[] = ["impressions", "reach", "clicks", "results"];
const DECIMAL: Field[] = ["spend", "frequency", "conversion_value"];

export interface ParseReport {
  columns: { mapped: Record<string, string>; ignored: string[]; missingOptional: string[] };
  rows: NormalizedRow[];
  rejected: { line: number; errors: string[] }[];
  fatal: string | null;
  currency: string | null;
}

export function parseMetaCsv(text: string): ParseReport {
  const parsed = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), { header: true, skipEmptyLines: "greedy" });
  const headers = parsed.meta.fields ?? [];
  const mapped: Record<string, string> = {};
  const ignored: string[] = [];
  for (const h of headers) {
    const field = (Object.keys(ALIASES) as Field[]).find((f) => ALIASES[f].test(h.trim()));
    if (field && !Object.values(mapped).includes(field)) mapped[h] = field;
    else ignored.push(h);
  }
  const present = new Set(Object.values(mapped));
  const missingRequired = REQUIRED.filter((f) => !present.has(f));
  const missingOptional = (Object.keys(ALIASES) as Field[]).filter((f) => !REQUIRED.includes(f) && !present.has(f));
  const currency = headers.map((h) => h.match(/amount spent \(([A-Z]{3})\)/i)?.[1]).find(Boolean) ?? null;

  const report: ParseReport = { columns: { mapped, ignored, missingOptional }, rows: [], rejected: [], fatal: null, currency };
  if (missingRequired.length) {
    report.fatal = `Missing required column(s): ${missingRequired.join(", ")}. Expected a Meta Ads Manager export broken down by day.`;
    return report;
  }

  parsed.data.forEach((raw, i) => {
    const line = i + 2; // header is line 1
    const errors: string[] = [];
    const row: Partial<Record<Field, string | number | null>> = {};
    for (const [header, field] of Object.entries(mapped)) {
      const v = (raw[header] ?? "").trim();
      if (v === "" || v === "-" || v.toLowerCase() === "n/a") {
        row[field as Field] = null;
        continue;
      }
      if (INTEGER.includes(field as Field) || DECIMAL.includes(field as Field)) {
        const n = Number(v.replace(/[,£$€\s]/g, ""));
        if (!Number.isFinite(n) || n < 0) errors.push(`${header}: "${v}" is not a valid non-negative number`);
        else row[field as Field] = INTEGER.includes(field as Field) ? Math.round(n) : n;
      } else {
        row[field as Field] = v;
      }
    }
    for (const f of REQUIRED) if (row[f] == null) errors.push(`${f} is empty`);
    if (typeof row.date === "string") {
      const d = normalizeDate(row.date);
      if (!d) errors.push(`date "${row.date}" is not a valid date (expected YYYY-MM-DD or DD/MM/YYYY)`);
      else row.date = d;
    }
    if (row.clicks != null && row.impressions != null && (row.clicks as number) > (row.impressions as number)) {
      errors.push("clicks exceed impressions");
    }
    if (errors.length) {
      report.rejected.push({ line, errors });
      return;
    }
    report.rows.push({
      date: row.date as string,
      account_id: String(row.account_id),
      account_name: (row.account_name as string) ?? null,
      campaign_name: String(row.campaign_name),
      ad_set_name: (row.ad_set_name as string) ?? "(not provided)",
      ad_name: (row.ad_name as string) ?? "(not provided)",
      spend: row.spend as number,
      impressions: row.impressions as number,
      reach: (row.reach as number) ?? null,
      frequency: (row.frequency as number) ?? null,
      clicks: (row.clicks as number) ?? null,
      results: (row.results as number) ?? null,
      result_type: (row.result_type as string) ?? null,
      conversion_value: (row.conversion_value as number) ?? null,
    });
  });
  return report;
}

export function normalizeDate(s: string): string | null {
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); // UK format, as exported for GBP accounts
  if (m) return valid(+m[3], +m[2], +m[1]);
  return null;
}
function valid(y: number, mo: number, d: number) {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? dt.toISOString().slice(0, 10) : null;
}

export const rowKey = (r: NormalizedRow) => [r.account_id, r.campaign_name, r.ad_set_name, r.ad_name, r.date].join("|");
