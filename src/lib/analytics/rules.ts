import { type FactRow, addDays, aggregate, fmt, pctChange } from "./metrics";

/**
 * Media Buyer detection rules. Deterministic and explainable on purpose: every alert carries
 * the numbers that triggered it, so the AI layer only *explains* findings — it never invents them.
 * Thresholds are configuration, not code changes.
 */

export const THRESHOLDS = {
  windowDays: 7,
  cprRisePct: 0.3,
  cprRiseHighPct: 0.5,
  minResultsPrev: 10,
  ctrDropPct: 0.2,
  fatigueFrequency: 3,
  minImpressions: 2000,
  spendSpikeMultiple: 2,
  spendSpikeMin: 50,
  topCreativeRatio: 0.7,
  topCreativeMinResults: 10,
  roasDropPct: 0.25,
  noResultsDays: 3,
  noResultsMinSpend: 30,
};

export interface PerfRow extends FactRow {
  client_id: number;
  campaign_name: string;
  ad_name: string;
}

export interface Evidence {
  metric: string;
  current: string;
  previous?: string;
  change?: string;
  window: string;
}

export interface Finding {
  client_id: number;
  campaign_name: string;
  ad_name: string | null;
  rule: string;
  severity: "high" | "medium" | "low" | "positive";
  title: string;
  detail: string;
  evidence: Evidence[];
  suggested_action: string;
  confidence: "high" | "medium" | "low";
  learning: string | null;
  fingerprint: string;
}

const groupBy = <T>(rows: T[], key: (r: T) => string) => {
  const m = new Map<string, T[]>();
  for (const r of rows) m.set(key(r), [...(m.get(key(r)) ?? []), r]);
  return m;
};

const confidenceFromResults = (n: number | null): Finding["confidence"] => (n == null ? "low" : n >= 30 ? "high" : n >= 10 ? "medium" : "low");

export function detect(rows: PerfRow[], t = THRESHOLDS): Finding[] {
  const findings: Finding[] = [];
  for (const [clientId, clientRows] of groupBy(rows, (r) => String(r.client_id))) {
    const end = clientRows.reduce((m, r) => (r.date > m ? r.date : m), "");
    const curStart = addDays(end, -(t.windowDays - 1));
    const prevStart = addDays(end, -(2 * t.windowDays - 1));
    const prevEnd = addDays(end, -t.windowDays);
    const inCur = (r: PerfRow) => r.date >= curStart && r.date <= end;
    const inPrev = (r: PerfRow) => r.date >= prevStart && r.date <= prevEnd;
    const curLabel = `${curStart} → ${end}`;
    const fp = (rule: string, campaign: string, ad = "") => [rule, clientId, campaign, ad, end].join("|");
    const cid = Number(clientId);

    for (const [campaign, cRows] of groupBy(clientRows, (r) => r.campaign_name)) {
      const cur = aggregate(cRows.filter(inCur));
      const prev = aggregate(cRows.filter(inPrev));

      // 1. Cost per result rising
      const cprChg = pctChange(cur.cpr, prev.cpr);
      if (cprChg != null && cprChg >= t.cprRisePct && (prev.results ?? 0) >= t.minResultsPrev) {
        findings.push({
          client_id: cid,
          campaign_name: campaign,
          ad_name: null,
          rule: "cpr_rising",
          severity: cprChg >= t.cprRiseHighPct ? "high" : "medium",
          title: `Cost per result up ${fmt.change(cprChg)} week-on-week`,
          detail: `Cost per result rose from ${fmt.money(prev.cpr)} to ${fmt.money(cur.cpr)} while spend moved ${fmt.change(pctChange(cur.spend, prev.spend))}.`,
          evidence: [
            { metric: "Cost per result", current: fmt.money(cur.cpr), previous: fmt.money(prev.cpr), change: fmt.change(cprChg), window: curLabel },
            { metric: "Results", current: fmt.int(cur.results), previous: fmt.int(prev.results), change: fmt.change(pctChange(cur.results, prev.results)), window: curLabel },
            { metric: "CTR", current: fmt.pct(cur.ctr), previous: fmt.pct(prev.ctr), change: fmt.change(pctChange(cur.ctr, prev.ctr)), window: curLabel },
          ],
          suggested_action: "Review which ad sets/ads drove the increase before changing budget; check for creative fatigue and audience overlap.",
          confidence: confidenceFromResults(Math.min(cur.results ?? 0, prev.results ?? 0)),
          learning: null,
          fingerprint: fp("cpr_rising", campaign),
        });
      }

      // 2. ROAS drop (only where conversion value is fully present)
      const roasChg = pctChange(cur.roas, prev.roas);
      if (roasChg != null && roasChg <= -t.roasDropPct) {
        findings.push({
          client_id: cid,
          campaign_name: campaign,
          ad_name: null,
          rule: "roas_drop",
          severity: "high",
          title: `ROAS down ${fmt.change(roasChg)} week-on-week`,
          detail: `ROAS fell from ${fmt.x(prev.roas)} to ${fmt.x(cur.roas)}.`,
          evidence: [
            { metric: "ROAS", current: fmt.x(cur.roas), previous: fmt.x(prev.roas), change: fmt.change(roasChg), window: curLabel },
            { metric: "Spend", current: fmt.money(cur.spend), previous: fmt.money(prev.spend), change: fmt.change(pctChange(cur.spend, prev.spend)), window: curLabel },
          ],
          suggested_action: "Check whether the drop is spend-driven (spike) or conversion-driven before reallocating budget.",
          confidence: confidenceFromResults(cur.results),
          learning: null,
          fingerprint: fp("roas_drop", campaign),
        });
      }

      // 3. Spend spike on a single day vs that day's trailing 7-day mean
      const byDay = groupBy(cRows, (r) => r.date);
      for (const [date, dRows] of byDay) {
        if (date < curStart) continue;
        const spend = aggregate(dRows).spend ?? 0;
        const trailing = [...Array(7)].map((_, i) => aggregate(byDay.get(addDays(date, -(i + 1))) ?? []).spend).filter((v): v is number => v != null);
        if (trailing.length < 5) continue;
        const mean = trailing.reduce((a, b) => a + b, 0) / trailing.length;
        if (spend > mean * t.spendSpikeMultiple && spend - mean > t.spendSpikeMin) {
          findings.push({
            client_id: cid,
            campaign_name: campaign,
            ad_name: null,
            rule: "spend_spike",
            severity: "medium",
            title: `Unusual spend on ${date}: ${fmt.money(spend)} vs ${fmt.money(mean)} daily average`,
            detail: `Spend on ${date} was ${(spend / mean).toFixed(1)}× the trailing 7-day average.`,
            evidence: [{ metric: "Daily spend", current: fmt.money(spend), previous: `${fmt.money(mean)} (7-day avg)`, change: fmt.change(pctChange(spend, mean)), window: date }],
            suggested_action: "Check for budget edits, a learning-phase reset or a delivery issue on that date in Ads Manager.",
            confidence: "high",
            learning: null,
            fingerprint: fp("spend_spike", campaign, date),
          });
        }
      }

      // Ad-level rules
      const campaignCur = cur;
      for (const [ad, aRows] of groupBy(cRows, (r) => r.ad_name)) {
        const aCur = aggregate(aRows.filter(inCur));
        const aPrev = aggregate(aRows.filter(inPrev));

        // 4. Creative fatigue: CTR falling while frequency is high
        const ctrChg = pctChange(aCur.ctr, aPrev.ctr);
        if (ctrChg != null && ctrChg <= -t.ctrDropPct && (aCur.frequency ?? 0) >= t.fatigueFrequency && (aPrev.impressions ?? 0) >= t.minImpressions) {
          findings.push({
            client_id: cid,
            campaign_name: campaign,
            ad_name: ad,
            rule: "creative_fatigue",
            severity: "medium",
            title: `Possible creative fatigue: "${ad}"`,
            detail: `CTR fell ${fmt.change(ctrChg)} while average frequency reached ${fmt.num(aCur.frequency, 1)}.`,
            evidence: [
              { metric: "CTR", current: fmt.pct(aCur.ctr), previous: fmt.pct(aPrev.ctr), change: fmt.change(ctrChg), window: curLabel },
              { metric: "Frequency", current: fmt.num(aCur.frequency, 1), previous: fmt.num(aPrev.frequency, 1), window: curLabel },
            ],
            suggested_action: "Prepare a refreshed creative on the same angle (new hook/visual) and review audience size.",
            confidence: (aCur.impressions ?? 0) >= 10_000 ? "high" : "medium",
            learning: `"${ad}" fatigued at frequency ${fmt.num(aCur.frequency, 1)} (CTR ${fmt.change(ctrChg)}) — the audience needs fresh hooks/visuals, not the same execution.`,
            fingerprint: fp("creative_fatigue", campaign, ad),
          });
        }

        // 5. Spending without results over the last N days
        const lastN = aRows.filter((r) => r.date > addDays(end, -t.noResultsDays));
        const lastAgg = aggregate(lastN);
        if (lastN.length >= t.noResultsDays && lastAgg.results === 0 && (lastAgg.spend ?? 0) >= t.noResultsMinSpend) {
          findings.push({
            client_id: cid,
            campaign_name: campaign,
            ad_name: ad,
            rule: "no_results",
            severity: "high",
            title: `"${ad}" spent ${fmt.money(lastAgg.spend)} with 0 results in ${t.noResultsDays} days`,
            detail: `No results recorded since ${addDays(end, -(t.noResultsDays - 1))} despite continued delivery (${fmt.int(lastAgg.impressions)} impressions).`,
            evidence: [
              { metric: "Spend", current: fmt.money(lastAgg.spend), window: `last ${t.noResultsDays} days` },
              { metric: "Results", current: "0", previous: fmt.int(aPrev.results), window: `last ${t.noResultsDays} days` },
              { metric: "Clicks", current: fmt.int(lastAgg.clicks), window: `last ${t.noResultsDays} days` },
            ],
            suggested_action: "Check tracking/landing page first (clicks still arriving?), then consider pausing this ad. A human must make the change in Ads Manager.",
            confidence: (lastAgg.clicks ?? 0) >= 20 ? "high" : "medium",
            learning: null,
            fingerprint: fp("no_results", campaign, ad),
          });
        }

        // 6. Top creative — positive signal fed back into idea generation
        if (
          aCur.cpr != null &&
          campaignCur.cpr != null &&
          aCur.cpr <= campaignCur.cpr * t.topCreativeRatio &&
          (aCur.results ?? 0) >= t.topCreativeMinResults &&
          groupBy(cRows, (r) => r.ad_name).size > 1
        ) {
          findings.push({
            client_id: cid,
            campaign_name: campaign,
            ad_name: ad,
            rule: "top_creative",
            severity: "positive",
            title: `Strong performer: "${ad}"`,
            detail: `Cost per result ${fmt.money(aCur.cpr)} vs campaign average ${fmt.money(campaignCur.cpr)} over the last ${t.windowDays} days.`,
            evidence: [
              { metric: "Cost per result (ad)", current: fmt.money(aCur.cpr), previous: `${fmt.money(campaignCur.cpr)} (campaign avg)`, window: curLabel },
              { metric: "Results", current: fmt.int(aCur.results), window: curLabel },
              { metric: "CTR", current: fmt.pct(aCur.ctr), previous: `${fmt.pct(campaignCur.ctr)} (campaign avg)`, window: curLabel },
            ],
            suggested_action: "Brief new variations on this angle (Idea Generator) and consider shifting budget towards it after review.",
            confidence: confidenceFromResults(aCur.results),
            learning: `"${ad}" in "${campaign}" beats the campaign cost per result by ${fmt.change(pctChange(aCur.cpr, campaignCur.cpr))} — this angle is resonating; explore more variations of it.`,
            fingerprint: fp("top_creative", campaign, ad),
          });
        }
      }
    }
  }
  const order = { high: 0, medium: 1, low: 2, positive: 3 };
  return findings.sort((a, b) => order[a.severity] - order[b.severity]);
}
