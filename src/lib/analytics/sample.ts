import { addDays } from "./metrics";

/**
 * Deterministic, clearly fictional Meta Ads Manager export (daily breakdown, GBP) for the 3 sample
 * clients. Patterns are injected so each detection rule has something real to find:
 *  - Harbour Lights "Night Shelter Video": CTR decays as frequency climbs  → creative fatigue
 *  - Harbour Lights "£25 One Night Carousel": far cheaper per donation    → top creative
 *  - Kettle & Crumb "Spring Subs – Broad": conversion rate drops + spike  → CPR rising, ROAS drop, spend spike
 *  - Kettle & Crumb "Gift Boxes": reach/frequency not exported             → shown as unavailable
 *  - Northfield "Dog Sofa Static": clicks continue, 0 leads for 4 days    → spending without results
 */

export const SAMPLE_END = "2026-11-08";
const DAYS = 28;

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface AdSpec {
  account: [string, string];
  campaign: string;
  adSet: string;
  ad: string;
  impressions: number;
  cpm: number;
  ctr: (day: number) => number;
  cvr: (day: number) => number;
  freq: (day: number) => number | null;
  resultType: string;
  aov: number | null;
  reach: boolean;
  spendMult?: (date: string) => number;
}

const HL: [string, string] = ["act_1001", "Harbour Lights — Main"];
const KC: [string, string] = ["act_1002", "Kettle & Crumb — Shop"];
const NF: [string, string] = ["act_1003", "Northfield Rescue"];
const flat = (v: number) => () => v;
const late = (d: number, from: number) => Math.max(0, d - from); // days past a changepoint

const ADS: AdSpec[] = [
  { account: HL, campaign: "Winter Appeal – Prospecting", adSet: "UK 30-60 past donors", ad: "Night Shelter Video", impressions: 9000, cpm: 6.2,
    ctr: (d) => 0.016 - late(d, 14) * 0.0006, cvr: flat(0.03), freq: (d) => 1.6 + d * 0.1, resultType: "Donations", aov: 24, reach: true },
  { account: HL, campaign: "Winter Appeal – Prospecting", adSet: "UK 30-60 past donors", ad: "Empty Bed Static", impressions: 7000, cpm: 5.8,
    ctr: flat(0.012), cvr: flat(0.028), freq: (d) => 1.4 + d * 0.04, resultType: "Donations", aov: 22, reach: true },
  { account: HL, campaign: "Winter Appeal – Retargeting", adSet: "Site visitors 30d", ad: "£25 One Night Carousel", impressions: 3500, cpm: 9.5,
    ctr: flat(0.024), cvr: flat(0.09), freq: (d) => 2 + d * 0.03, resultType: "Donations", aov: 31, reach: true },
  { account: HL, campaign: "Winter Appeal – Retargeting", adSet: "Site visitors 30d", ad: "Impact Report Static", impressions: 3500, cpm: 9.1,
    ctr: flat(0.014), cvr: flat(0.045), freq: (d) => 2 + d * 0.03, resultType: "Donations", aov: 27, reach: true },
  { account: KC, campaign: "Spring Subs – Broad", adSet: "UK tea lovers 25-45", ad: "Cosy Ritual UGC", impressions: 12000, cpm: 7.4,
    ctr: flat(0.013), cvr: (d) => (d >= 21 ? 0.022 : 0.034), freq: (d) => 1.3 + d * 0.03, resultType: "Purchases", aov: 19.5, reach: true,
    spendMult: (date) => (date === "2026-11-04" ? 3.2 : 1) },
  { account: KC, campaign: "Spring Subs – Broad", adSet: "UK tea lovers 25-45", ad: "Half Price Box Static", impressions: 10000, cpm: 7.1,
    ctr: flat(0.011), cvr: (d) => (d >= 21 ? 0.02 : 0.03), freq: (d) => 1.3 + d * 0.03, resultType: "Purchases", aov: 19.5, reach: true,
    spendMult: (date) => (date === "2026-11-04" ? 3.2 : 1) },
  { account: KC, campaign: "Gift Boxes – Lookalike", adSet: "LAL 1% purchasers", ad: "Gift Unboxing Video", impressions: 6000, cpm: 8.2,
    ctr: flat(0.015), cvr: flat(0.04), freq: () => null, resultType: "Purchases", aov: 34, reach: false },
  { account: NF, campaign: "Foster Leads – Local", adSet: "15km radius 25-55", ad: "Kitten Foster Story", impressions: 5000, cpm: 5.2,
    ctr: flat(0.017), cvr: flat(0.06), freq: (d) => 1.2 + d * 0.05, resultType: "Leads", aov: null, reach: true },
  { account: NF, campaign: "Foster Leads – Local", adSet: "15km radius 25-55", ad: "Dog Sofa Static", impressions: 4500, cpm: 5.0,
    ctr: flat(0.015), cvr: (d) => (d >= DAYS - 4 ? 0 : 0.05), freq: (d) => 1.2 + d * 0.05, resultType: "Leads", aov: null, reach: true },
];

export function generateSampleCsv(): string {
  const r = rng(20261108);
  const noise = (spread = 0.12) => 1 + (r() * 2 - 1) * spread;
  const start = addDays(SAMPLE_END, -(DAYS - 1));
  const header = [
    "Day", "Account ID", "Account name", "Campaign name", "Ad set name", "Ad name", "Amount spent (GBP)",
    "Impressions", "Reach", "Frequency", "Link clicks", "Results", "Result indicator", "Conversion value",
  ];
  const lines = [header.join(",")];
  for (let d = 0; d < DAYS; d++) {
    const date = addDays(start, d);
    for (const a of ADS) {
      const mult = a.spendMult?.(date) ?? 1;
      const impressions = Math.round(a.impressions * noise() * mult);
      const spend = (impressions / 1000) * a.cpm * noise(0.06);
      const clicks = Math.round(impressions * a.ctr(d) * noise());
      const results = Math.round(clicks * a.cvr(d) * noise(0.25));
      const freq = a.freq(d);
      const reach = a.reach && freq ? Math.round(impressions / freq) : null;
      const value = a.aov == null ? null : results * a.aov * noise(0.1);
      const cells = [
        date, a.account[0], a.account[1], a.campaign, a.adSet, a.ad, spend.toFixed(2), impressions,
        reach ?? "", freq == null ? "" : freq.toFixed(2), clicks, results, a.resultType, value == null ? "" : value.toFixed(2),
      ];
      lines.push(cells.map((c) => (/[,"]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c)).join(","));
    }
  }
  return lines.join("\n") + "\n";
}
