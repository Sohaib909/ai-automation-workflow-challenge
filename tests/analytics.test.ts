import { describe, expect, it } from "vitest";
import { normalizeDate, parseMetaCsv } from "@/lib/analytics/csv";
import { aggregate } from "@/lib/analytics/metrics";
import { detect } from "@/lib/analytics/rules";
import { generateSampleCsv } from "@/lib/analytics/sample";

const H = "Day,Account ID,Campaign name,Ad set name,Ad name,Amount spent (GBP),Impressions,Reach,Link clicks,Results,Conversion value,Extra col";

describe("CSV parsing and validation", () => {
  it("maps Meta column aliases, reports ignored columns and currency", () => {
    const r = parseMetaCsv(`${H}\n2026-11-01,act_1,C,S,A,10.50,1000,800,20,2,40,x\n`);
    expect(r.fatal).toBeNull();
    expect(r.currency).toBe("GBP");
    expect(r.columns.ignored).toEqual(["Extra col"]);
    expect(r.columns.missingOptional).toContain("frequency");
    expect(r.rows[0]).toMatchObject({ spend: 10.5, impressions: 1000, clicks: 20, results: 2, conversion_value: 40 });
  });
  it("keeps blank cells as null, never 0", () => {
    const r = parseMetaCsv(`${H}\n2026-11-01,act_1,C,S,A,10,1000,,,,,\n`);
    expect(r.rows[0]).toMatchObject({ reach: null, clicks: null, results: null, conversion_value: null });
  });
  it("rejects bad rows with line numbers but keeps good ones", () => {
    const r = parseMetaCsv(`${H}\n2026-11-01,act_1,C,S,A,abc,1000,,,,,\n2026-13-01,act_1,C,S,A,1,1000,,,,,\n2026-11-02,act_1,C,S,A,1,10,,50,,,\n2026-11-03,act_1,C,S,A,1,1000,,,,,\n`);
    expect(r.rows).toHaveLength(1);
    expect(r.rejected.map((x) => x.line)).toEqual([2, 3, 4]);
    expect(r.rejected[2].errors[0]).toMatch(/clicks exceed impressions/);
  });
  it("fails fast when required columns are missing", () => {
    expect(parseMetaCsv("Campaign name,Impressions\nC,1\n").fatal).toMatch(/date, account_id, spend/);
  });
  it("normalizes UK dates and rejects impossible ones", () => {
    expect(normalizeDate("08/11/2026")).toBe("2026-11-08");
    expect(normalizeDate("31/02/2026")).toBeNull();
  });
});

describe("metrics", () => {
  const row = (o: Partial<Parameters<typeof aggregate>[0][number]>) => ({ date: "2026-11-01", spend: null, impressions: null, reach: null, frequency: null, clicks: null, results: null, conversion_value: null, ...o });
  it("recomputes ratios from sums, not by averaging", () => {
    const t = aggregate([row({ spend: 10, impressions: 1000, clicks: 10, results: 1 }), row({ spend: 90, impressions: 9000, clicks: 270, results: 9 })]);
    expect(t.ctr).toBeCloseTo(280 / 10000);
    expect(t.cpr).toBeCloseTo(10);
    expect(t.cpm).toBeCloseTo(10);
  });
  it("returns null (unavailable) for missing inputs and zero denominators", () => {
    const t = aggregate([row({ spend: 10, impressions: 1000 })]);
    expect(t.clicks).toBeNull();
    expect(t.ctr).toBeNull();
    expect(t.cpr).toBeNull();
    expect(t.roas).toBeNull();
    expect(aggregate([row({ spend: 10, impressions: 1000, results: 0 })]).cpr).toBeNull();
  });
  it("only reports ROAS when conversion value is present on every row", () => {
    expect(aggregate([row({ spend: 10, conversion_value: 30 }), row({ spend: 10 })]).roas).toBeNull();
    expect(aggregate([row({ spend: 10, conversion_value: 30 }), row({ spend: 10, conversion_value: 10 })]).roas).toBeCloseTo(2);
  });
});

describe("detection rules on the sample dataset", () => {
  const parsed = parseMetaCsv(generateSampleCsv());
  const clientOf: Record<string, number> = { act_1001: 1, act_1002: 2, act_1003: 3 };
  const rows = parsed.rows.map((r) => ({ ...r, client_id: clientOf[r.account_id] }));
  const findings = detect(rows);
  const has = (rule: string, where: (f: (typeof findings)[number]) => boolean) => findings.some((f) => f.rule === rule && where(f));

  it("sample CSV parses cleanly", () => {
    expect(parsed.fatal).toBeNull();
    expect(parsed.rejected).toEqual([]);
    expect(parsed.rows).toHaveLength(28 * 9);
  });
  it("finds the injected patterns", () => {
    expect(has("creative_fatigue", (f) => f.ad_name === "Night Shelter Video")).toBe(true);
    expect(has("top_creative", (f) => f.ad_name === "£25 One Night Carousel")).toBe(true);
    expect(has("spend_spike", (f) => f.campaign_name === "Spring Subs – Broad" && f.title.includes("2026-11-04"))).toBe(true);
    expect(has("roas_drop", (f) => f.campaign_name === "Spring Subs – Broad")).toBe(true);
    expect(has("no_results", (f) => f.ad_name === "Dog Sofa Static")).toBe(true);
  });
  it("does not raise ROAS findings where conversion value is absent (lead gen)", () => {
    expect(findings.some((f) => f.rule === "roas_drop" && f.client_id === 3)).toBe(false);
  });
  it("every finding carries evidence and a unique fingerprint", () => {
    for (const f of findings) expect(f.evidence.length).toBeGreaterThan(0);
    expect(new Set(findings.map((f) => f.fingerprint)).size).toBe(findings.length);
  });
  it("is deterministic", () => {
    expect(generateSampleCsv()).toBe(generateSampleCsv());
  });
});
