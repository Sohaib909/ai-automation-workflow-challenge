import "server-only";
import { z } from "zod";
import { getDb } from "./db";
import { generateStructured } from "./ai/generate";
import { ALLOWED_CTAS, extractFigures } from "./qc";

/**
 * "Fill with AI" for forms. Suggests values for EMPTY fields only, using what the system already knows:
 * the client's profile, previous campaigns/briefs, approved performance learnings and what the user typed.
 * Facts are never generated: proof points are only reused from the client's previous briefs, and any
 * AI suggestion containing a figure not found in that history is dropped.
 */

export type FormKind = "campaign" | "brief" | "client";

import { GOALS } from "./goals";
export { GOALS };

const FIELDS: Record<FormKind, string[]> = {
  campaign: ["name", "goal", "product", "offer", "audience", "pain_points", "tone", "cta"],
  brief: ["product", "offer", "audience", "pain_points", "tone"],
  client: ["sector", "brand_voice", "banned_claims"],
};

const LABELS: Record<string, string> = {
  name: "campaign name",
  goal: `goal (one of: ${GOALS.join(", ")})`,
  product: "what is being promoted",
  offer: "the offer or ask",
  audience: "who it is for",
  pain_points: "what stops people acting (separate with ;)",
  tone: "tone of voice (a few words)",
  cta: `ad button (one of: ${ALLOWED_CTAS.join(", ")})`,
  sector: "sector / type of organisation",
  brand_voice: "brand voice (one sentence)",
  banned_claims: "phrases the AI must never use (one per line)",
  new_client: "new client name",
  proof_points: "facts the AI may use",
};

export interface Suggestion {
  values: Record<string, string>;
  sources: Record<string, string>;
  skipped: string[];
  isMock: boolean;
}

interface ClientRow {
  id: number;
  name: string;
  sector: string;
  brand_voice: string;
  brand_guidelines: string;
  banned_claims: string;
}
interface PastBrief {
  campaign: string;
  objective: string;
  product: string;
  offer: string;
  audience: string;
  pain_points: string;
  proof_points: string;
  tone: string;
  cta: string;
}

function history(clientId: number) {
  const db = getDb();
  const client = db.prepare("SELECT * FROM clients WHERE id = ?").get(clientId) as ClientRow | undefined;
  const briefs = db
    .prepare(
      `SELECT k.name AS campaign, k.objective, b.product, b.offer, b.audience, b.pain_points, b.proof_points, b.tone, b.cta
         FROM campaigns k JOIN briefs b ON b.campaign_id = k.id
        WHERE k.client_id = ? AND b.version = (SELECT MAX(version) FROM briefs WHERE campaign_id = k.id)
        ORDER BY k.id DESC LIMIT 5`,
    )
    .all(clientId) as unknown as PastBrief[];
  const learnings = (
    db.prepare("SELECT learning FROM recommendations WHERE client_id = ? AND status = 'approved' AND learning IS NOT NULL ORDER BY id DESC LIMIT 3").all(clientId) as {
      learning: string;
    }[]
  ).map((l) => l.learning);
  const ideas = (
    db
      .prepare("SELECT i.title FROM ideas i JOIN campaigns k ON k.id = i.campaign_id WHERE k.client_id = ? AND i.status IN ('approved','ai_selected') ORDER BY i.id DESC LIMIT 5")
      .all(clientId) as { title: string }[]
  ).map((i) => i.title);
  return { client, briefs, learnings, ideas };
}

const empty = (v?: string) => !v || !v.trim();

export async function suggestFields(kind: FormKind, typed: Record<string, string>, ctx: { clientId?: number; campaignId?: number }): Promise<Suggestion> {
  const { h, known, sourceText, sourceLabel } = gather(typed, ctx);

  const want = FIELDS[kind].filter((f) => empty(typed[f]));
  const values: Record<string, string> = {};
  const sources: Record<string, string> = {};
  const skipped: string[] = [];

  // Facts are copied from previous briefs, never written by AI.
  if (kind !== "client" && empty(typed.proof_points)) {
    const facts = [...new Set(h.briefs.flatMap((b) => b.proof_points.split("\n").map((s) => s.trim()).filter(Boolean)))].slice(0, 6);
    if (facts.length) {
      values.proof_points = facts.join("\n");
      sources.proof_points = `Reused from ${h.briefs.length === 1 ? `“${h.briefs[0].campaign}”` : `${h.briefs.length} previous campaigns`}. Check they're still true.`;
    }
  }
  if (!want.length) return { values, sources, skipped, isMock: false };

  const schema = z.object(Object.fromEntries(want.map((f) => [f, z.string().max(600).optional().default("")])) as Record<string, z.ZodDefault<z.ZodOptional<z.ZodString>>>);
  const out = await generateStructured({
    task: `suggest.${kind}`,
    schema,
    system: `You help an agency account manager fill in a form quickly. Suggest short, specific values that fit the client and what the user already typed.
Rules: base suggestions on the information given; if there is nothing to go on for a field, return an empty string for it.
NEVER include numbers, prices, statistics or amounts unless they appear in the information given. British English. Reply with JSON only.`,
    prompt: `${known}\n\nSuggest values for these fields:\n${want.map((f) => `- "${f}": ${LABELS[f]}`).join("\n")}\n\nJSON: {${want.map((f) => `"${f}":""`).join(",")}}`,
    temperature: 0.5,
    mock: () => mockSuggest(want, h.briefs[0], h.client, typed),
  });

  // Guard: drop any suggestion with a figure not present in the client's own history or the user's input.
  for (const f of want) {
    let v = String((out.data as Record<string, string>)[f] ?? "").trim();
    if (!v) continue;
    if (f === "goal" && !GOALS.includes(v)) continue;
    if (f === "cta" && !(ALLOWED_CTAS as readonly string[]).includes(v)) continue;
    const unknown = unknownFigures(v, sourceText);
    if (unknown.length) {
      skipped.push(`${LABELS[f] ?? f} (suggested a figure, ${unknown.join(", ")}, that isn't in your data)`);
      continue;
    }
    if (f === "banned_claims") v = v.replace(/;\s*/g, "\n");
    values[f] = v;
    sources[f] = sourceLabel;
  }
  return { values, sources, skipped, isMock: out.isMock };
}

/* ---------- Shared context ---------- */
function gather(typed: Record<string, string>, ctx: { clientId?: number; campaignId?: number }) {
  let clientId = ctx.clientId;
  if (!clientId && ctx.campaignId) clientId = (getDb().prepare("SELECT client_id FROM campaigns WHERE id = ?").get(ctx.campaignId) as { client_id: number } | undefined)?.client_id;
  const h = clientId ? history(clientId) : { client: undefined, briefs: [] as PastBrief[], learnings: [] as string[], ideas: [] as string[] };
  const known = [
    h.client && `CLIENT: ${h.client.name} — ${h.client.sector}\nBRAND VOICE: ${h.client.brand_voice}\nNEVER SAY: ${h.client.banned_claims.split("\n").filter(Boolean).join("; ")}`,
    h.briefs.length && `PREVIOUS CAMPAIGNS (most recent first):\n${h.briefs.map((b) => `- ${b.campaign} (${b.objective}): promoting "${b.product}"; offer "${b.offer}"; audience "${b.audience}"; barriers "${b.pain_points}"; tone "${b.tone}"; button "${b.cta}"`).join("\n")}`,
    h.learnings.length && `WHAT WORKED IN THEIR ADS:\n${h.learnings.map((l) => `- ${l}`).join("\n")}`,
    h.ideas.length && `PAST APPROVED IDEAS: ${h.ideas.join("; ")}`,
    `ALREADY TYPED BY THE USER:\n${Object.entries(typed).filter(([k, v]) => k in LABELS && !empty(v)).map(([k, v]) => `- ${LABELS[k] ?? k}: ${v}`).join("\n") || "(nothing)"}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const sourceText = `${JSON.stringify(h.briefs)} ${Object.values(typed).join(" ")}`.replace(/,/g, "");
  const sourceLabel = h.briefs.length ? "Based on this client's previous campaigns" : h.client ? "Based on the client profile" : "Based on what you typed";
  return { h, known, sourceText, sourceLabel };
}

const unknownFigures = (v: string, sourceText: string) => extractFigures(v).filter((fig) => !sourceText.includes(fig.replace(/[,\s]/g, "")));

/* ---------- Suggest one field: up to 3 options to pick from ---------- */
export interface FieldOptions {
  options: string[];
  source: string;
  skipped: number;
  isMock: boolean;
  /** "append" = add as a new line (facts); "replace" = use as the field value */
  mode: "replace" | "append";
}

export async function suggestOne(field: string, typed: Record<string, string>, ctx: { clientId?: number; campaignId?: number }): Promise<FieldOptions> {
  if (!(field in LABELS)) throw new Error("Unknown field");
  const { h, known, sourceText, sourceLabel } = gather(typed, ctx);

  // Facts: only ever offered from previous briefs, never written by AI.
  if (field === "proof_points") {
    const already = new Set((typed.proof_points ?? "").split("\n").map((x) => x.trim()));
    const facts = [...new Set(h.briefs.flatMap((b) => b.proof_points.split("\n").map((x) => x.trim()).filter(Boolean)))].filter((f) => !already.has(f));
    return {
      options: facts.slice(0, 5),
      source: facts.length ? "Facts from this client's previous briefs. Check they're still true." : "No saved facts for this client yet. Facts must come from you, so the AI won't make them up.",
      skipped: 0,
      isMock: false,
      mode: "append",
    };
  }
  if (field === "goal") return pickFrom(GOALS, h.briefs.map((b) => b.objective));
  if (field === "cta") return pickFrom([...ALLOWED_CTAS], h.briefs.map((b) => b.cta));

  const current = typed[field]?.trim();
  const out = await generateStructured({
    task: `suggest.field.${field}`,
    schema: z.object({ options: z.array(z.string().max(600)).max(5) }),
    system: `You help an agency account manager fill in one form field. Give 3 short, clearly different options for the field, fitting the client and what is already typed.
NEVER include numbers, prices, statistics or amounts unless they appear in the information given. British English. Reply with JSON only.`,
    prompt: `${known}\n\nField: "${field}": ${LABELS[field]}${current ? `\nCurrent value (offer better alternatives): ${current}` : ""}\n\nJSON: {"options":["","",""]}`,
    temperature: 0.8,
    mock: () => ({ options: mockOptions(field, h.briefs[0], h.client, typed) }),
  });
  let skipped = 0;
  const options = [...new Set(out.data.options.map((o) => (field === "banned_claims" ? o.replace(/;\s*/g, "\n") : o).trim()).filter(Boolean))].filter((o) => {
    const bad = unknownFigures(o, sourceText).length > 0;
    if (bad) skipped++;
    return !bad && o !== current;
  });
  return { options: options.slice(0, 3), source: sourceLabel, skipped, isMock: out.isMock, mode: "replace" };
}

/** For dropdowns: prefer what this client used before, otherwise sensible defaults — always valid options. */
function pickFrom(allowed: string[], used: string[]): FieldOptions {
  const prior = [...new Set(used.filter((u) => allowed.includes(u)))];
  const options = [...prior, ...allowed.filter((a) => !prior.includes(a))].slice(0, 3);
  return { options, source: prior.length ? "Used in this client's previous campaigns first" : "Common choices", skipped: 0, isMock: false, mode: "replace" };
}

function mockOptions(field: string, last: PastBrief | undefined, client: ClientRow | undefined, typed: Record<string, string>) {
  const base = mockSuggest([field], last, client, typed)[field];
  return base ? [base, `${base} (alternative)`] : [];
}

function mockSuggest(want: string[], last: PastBrief | undefined, client: ClientRow | undefined, typed: Record<string, string>) {
  const r: Record<string, string> = {};
  for (const f of want) {
    if (last && f in last) r[f] = String(last[f as keyof PastBrief]);
    else if (f === "name") r[f] = `${client?.name ?? "New"} campaign`;
    else if (f === "goal") r[f] = last?.objective && GOALS.includes(last.objective) ? last.objective : "Donations";
    else if (f === "tone") r[f] = client?.brand_voice.split(".")[0] ?? "Warm, clear";
    else if (f === "cta") r[f] = "Learn More";
    else if (f === "sector") r[f] = typed.name ? `Organisation: ${typed.name}` : "";
    else if (f === "brand_voice") r[f] = "Warm, clear and direct.";
    else if (f === "banned_claims") r[f] = "guaranteed\n100%";
    else r[f] = "";
  }
  return r;
}
