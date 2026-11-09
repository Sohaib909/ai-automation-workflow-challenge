import type { DatabaseSync } from "node:sqlite";

/**
 * Schema for the MVP. Idempotent (CREATE IF NOT EXISTS). Kept intentionally small:
 * only the entities the two demos need, but shaped so the remaining modules
 * (creatives, scripts, video jobs, landing pages) can hang off campaigns/ideas the
 * same way copy does. See docs/DATABASE.md.
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  sector TEXT NOT NULL,
  brand_voice TEXT NOT NULL DEFAULT '',
  brand_guidelines TEXT NOT NULL DEFAULT '',
  banned_claims TEXT NOT NULL DEFAULT '',      -- newline-separated phrases copy must never use
  is_sample INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ad_accounts (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  platform TEXT NOT NULL DEFAULT 'meta',
  external_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  objective TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'meta',
  settings_json TEXT NOT NULL DEFAULT '{}',   -- AI settings: counts, per-agent choices, which agents to run
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_campaigns_client ON campaigns(client_id);

CREATE TABLE IF NOT EXISTS briefs (
  id INTEGER PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  product TEXT NOT NULL,
  audience TEXT NOT NULL,
  pain_points TEXT NOT NULL DEFAULT '',
  offer TEXT NOT NULL DEFAULT '',
  proof_points TEXT NOT NULL DEFAULT '',       -- the ONLY facts/figures AI may use
  tone TEXT NOT NULL DEFAULT '',
  cta TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE (campaign_id, version)
);

CREATE TABLE IF NOT EXISTS ideas (
  id INTEGER PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  brief_id INTEGER NOT NULL REFERENCES briefs(id),
  batch_id TEXT NOT NULL,
  title TEXT NOT NULL,
  lens TEXT NOT NULL,
  core_concept TEXT NOT NULL,
  audience_insight TEXT NOT NULL,
  hook TEXT NOT NULL,
  visual_direction TEXT NOT NULL,
  copy_direction TEXT NOT NULL,
  video_concept TEXT NOT NULL,
  test_hypothesis TEXT NOT NULL,
  rationale TEXT NOT NULL,
  scores_json TEXT NOT NULL,
  total_score REAL NOT NULL,
  warnings_json TEXT NOT NULL DEFAULT '[]',
  learnings_used_json TEXT NOT NULL DEFAULT '[]',  -- performance learnings that informed this idea
  status TEXT NOT NULL DEFAULT 'pending_review',
  rating INTEGER,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ideas_campaign ON ideas(campaign_id);

CREATE TABLE IF NOT EXISTS copy_variations (
  id INTEGER PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  idea_id INTEGER NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
  batch_id TEXT NOT NULL,
  lineage_id TEXT NOT NULL,                     -- stable id across versions of one variation
  version INTEGER NOT NULL DEFAULT 1,
  is_current INTEGER NOT NULL DEFAULT 1,
  angle TEXT NOT NULL,
  hook TEXT NOT NULL,
  headline TEXT NOT NULL,
  primary_text TEXT NOT NULL,
  description TEXT NOT NULL,
  cta TEXT NOT NULL,
  qc_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_review',
  change_note TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_copy_campaign ON copy_variations(campaign_id, is_current);

-- Outputs of the production agents (script, static creative, UGC pack, edit plan, landing page).
-- One generic table: each row keeps the source idea/copy/script it was made from, its version, QC and approval status.
CREATE TABLE IF NOT EXISTS agent_outputs (
  id INTEGER PRIMARY KEY,
  agent TEXT NOT NULL,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  idea_id INTEGER NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
  source_output_id INTEGER REFERENCES agent_outputs(id),  -- e.g. the approved script a UGC pack was built from
  source_copy_id INTEGER REFERENCES copy_variations(id),
  options_json TEXT NOT NULL DEFAULT '{}',
  content_json TEXT NOT NULL,
  qc_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_review',
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_outputs ON agent_outputs(agent, campaign_id);

-- One AI autopilot run over a campaign: every agent in sequence, progress tracked per step.
CREATE TABLE IF NOT EXISTS workflow_runs (
  id INTEGER PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  status TEXT NOT NULL,                      -- running | completed | completed_with_errors | failed
  steps_json TEXT NOT NULL,                  -- [{key,label,status,detail,started_at,finished_at}]
  started_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_runs_campaign ON workflow_runs(campaign_id);

CREATE TABLE IF NOT EXISTS approvals (
  id INTEGER PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  decision TEXT NOT NULL,
  reviewer TEXT NOT NULL,
  comment TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_approvals_entity ON approvals(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS ad_imports (
  id INTEGER PRIMARY KEY,
  filename TEXT NOT NULL,
  source TEXT NOT NULL,
  file_hash TEXT NOT NULL UNIQUE,
  rows_total INTEGER NOT NULL,
  rows_inserted INTEGER NOT NULL,
  rows_duplicate INTEGER NOT NULL,
  rows_rejected INTEGER NOT NULL,
  report_json TEXT NOT NULL,
  imported_at TEXT NOT NULL
);

-- Raw daily facts as imported. NULL means "not present in the source" — never 0.
CREATE TABLE IF NOT EXISTS ad_performance (
  id INTEGER PRIMARY KEY,
  import_id INTEGER NOT NULL REFERENCES ad_imports(id) ON DELETE CASCADE,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  ad_account_id INTEGER NOT NULL REFERENCES ad_accounts(id),
  date TEXT NOT NULL,
  campaign_name TEXT NOT NULL,
  ad_set_name TEXT NOT NULL,
  ad_name TEXT NOT NULL,
  spend REAL,
  impressions INTEGER,
  reach INTEGER,
  frequency REAL,
  clicks INTEGER,
  results INTEGER,
  result_type TEXT,
  conversion_value REAL,
  row_key TEXT NOT NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_perf_client_date ON ad_performance(client_id, date);

CREATE TABLE IF NOT EXISTS recommendations (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  campaign_name TEXT NOT NULL,
  ad_name TEXT,
  rule TEXT NOT NULL,
  severity TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  suggested_action TEXT NOT NULL,
  confidence TEXT NOT NULL,
  learning TEXT,                                -- creative learning fed back to the Idea Generator
  status TEXT NOT NULL DEFAULT 'open',          -- open | approved | rejected | dismissed
  fingerprint TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS insights (
  id INTEGER PRIMARY KEY,
  client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  content_json TEXT NOT NULL,
  warnings_json TEXT NOT NULL DEFAULT '[]',
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_logs (
  id INTEGER PRIMARY KEY,
  task TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  latency_ms INTEGER NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  error TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id INTEGER,
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
`;

/** A new database starts empty. Sample clients are only created when the user loads the sample Meta dataset. */
export function seed(d: DatabaseSync) {
  const { n } = d.prepare("SELECT COUNT(*) AS n FROM audit_log").get() as { n: number };
  if (n === 0) d.prepare("INSERT INTO audit_log (actor, action, entity_type, detail, created_at) VALUES ('system','init','database','Empty database created',?)").run(new Date().toISOString());
}

/**
 * Creates the 3 clearly fictional sample clients whose ad account IDs match the generated sample Meta CSV.
 * Idempotent; called only when the user clicks "Load sample dataset" (and by tests).
 */
export function ensureSampleClients(d: DatabaseSync) {
  const exists = d.prepare("SELECT 1 FROM ad_accounts WHERE external_id = 'act_1001'").get();
  if (exists) return;
  const ts = new Date().toISOString();
  const client = d.prepare(
    "INSERT INTO clients (name, sector, brand_voice, brand_guidelines, banned_claims, is_sample, created_at) VALUES (?,?,?,?,?,1,?)",
  );
  const account = d.prepare("INSERT INTO ad_accounts (client_id, external_id, name) VALUES (?,?,?)");

  d.exec("BEGIN");
  const c1 = Number(
    client.run(
      "Harbour Lights Foundation",
      "Charity — youth homelessness (UK)",
      "Warm, direct, hopeful. Speak to the donor as a partner, never guilt-trip.",
      "Use 'young people', never 'the homeless'. British English. No stock-photo misery imagery.",
      "100% of your donation\nend homelessness\nguaranteed",
      ts,
    ).lastInsertRowid,
  );
  account.run(c1, "act_1001", "Harbour Lights — Main");

  const c2 = Number(
    client.run(
      "Kettle & Crumb",
      "DTC — loose-leaf tea subscription",
      "Playful, cosy, a little cheeky. Short sentences.",
      "British English. Never knock competitors by name.",
      "detox\ncures\nweight loss",
      ts,
    ).lastInsertRowid,
  );
  account.run(c2, "act_1002", "Kettle & Crumb — Shop");

  const c3 = Number(
    client.run(
      "Northfield Animal Rescue",
      "Charity — animal rescue and fostering",
      "Kind, practical, upbeat.",
      "Always show animals in safe, happy settings.",
      "",
      ts,
    ).lastInsertRowid,
  );
  account.run(c3, "act_1003", "Northfield Rescue");

  d.prepare("INSERT INTO audit_log (actor, action, entity_type, detail, created_at) VALUES ('system','seed','database','Created 3 fictional sample clients for the sample Meta dataset',?)").run(ts);
  d.exec("COMMIT");
}
