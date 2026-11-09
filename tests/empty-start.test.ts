import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { createClient, createCampaign, listCampaigns, listClients } from "@/lib/creative/service";
import { importCsv } from "@/lib/analytics/service";
import { generateSampleCsv } from "@/lib/analytics/sample";

describe("fresh database", () => {
  it("starts with no clients, campaigns or ad data", () => {
    const n = (t: string) => (getDb().prepare(`SELECT COUNT(*) n FROM ${t}`).get() as { n: number }).n;
    expect(listClients()).toEqual([]);
    expect(listCampaigns()).toEqual([]);
    expect(n("ad_performance")).toBe(0);
    expect(n("recommendations")).toBe(0);
  });

  it("rejects sample rows until their clients exist, and maps a user-created client by ad account", () => {
    const r = importCsv(generateSampleCsv(), "sample.csv", "upload");
    expect(r.inserted).toBe(0);
    expect(r.unmappedAccounts.sort()).toEqual(["act_1001", "act_1002", "act_1003"]);

    const id = createClient({ name: "My Charity", sector: "Charity", brand_voice: "", brand_guidelines: "", banned_claims: "", ad_account_id: "1003" });
    expect(() => createClient({ name: "My Charity", sector: "x", brand_voice: "", brand_guidelines: "", banned_claims: "" })).toThrow(/already exists/);
    expect(createCampaign({ client_id: id, name: "Foster drive", objective: "Leads", platform: "meta" })).toBeGreaterThan(0);
    const csv = generateSampleCsv().split("\n");
    const r2 = importCsv([csv[0], ...csv.filter((l) => l.includes("act_1003"))].join("\n"), "mine.csv", "upload");
    expect(r2.inserted).toBe(28 * 2);
  });
});
