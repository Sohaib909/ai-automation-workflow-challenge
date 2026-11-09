import "server-only";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { SCHEMA_SQL, seed } from "./schema";

/**
 * Storage. The app always works on an in-memory SQLite (built into Node) so every query is plain SQL.
 * Where that data lives between requests depends on the environment:
 *
 *  - Local:  a JSON file, ./data/cerealbox.json, saved after every change. No setup.
 *  - Vercel / any serverless host: Turso (hosted SQLite), when TURSO_DATABASE_URL + TURSO_AUTH_TOKEN are set.
 *    Serverless functions don't share a disk, so each request first loads the latest snapshot from Turso
 *    (syncStore) and saves its changes back (flushStore). Saves are merged row by row: a save only applies
 *    the rows this function actually changed, so two functions writing at once don't overwrite each other.
 *  - Tests:  STORE_FILE=":memory:" (nothing persisted).
 */

let db: DatabaseSync | null = null;
let remoteVersion = -1; // version of the Turso snapshot the in-memory copy is based on

const TABLE_FILTER = "type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '\\_%' ESCAPE '\\'";

export function storeFile(): string | null {
  const f = process.env.STORE_FILE ?? (process.env.VERCEL ? "/tmp/cerealbox.json" : path.join(process.cwd(), "data", "cerealbox.json"));
  return f === ":memory:" ? null : f;
}

export function remoteConfigured() {
  return !!process.env.TURSO_DATABASE_URL;
}

export function getDb(): DatabaseSync {
  if (db) return db;
  db = remoteConfigured() ? openStore(null, undefined, true) : openStore(storeFile());
  return db;
}

type Snapshot = { format?: string; saved_at?: string; tables?: Record<string, Record<string, unknown>[]> };

/** Build an in-memory store, optionally from a JSON file or a snapshot object. */
export function openStore(file: string | null, data?: Snapshot, trackChanges = false): DatabaseSync {
  const d = new DatabaseSync(":memory:");
  d.exec("PRAGMA foreign_keys = ON;");
  d.exec(SCHEMA_SQL);
  const initial = data ?? (file && fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as Snapshot) : undefined);
  if (initial) load(d, initial);
  if (trackChanges) installChangeTracking(d);
  persistOnWrite(d, file);
  seed(d);
  return d;
}

function tables(d: DatabaseSync): string[] {
  return (d.prepare(`SELECT name FROM sqlite_master WHERE ${TABLE_FILTER} ORDER BY name`).all() as { name: string }[]).map((t) => t.name);
}

function load(d: DatabaseSync, data: Snapshot) {
  const known = new Set(tables(d));
  d.exec("PRAGMA foreign_keys = OFF; BEGIN");
  for (const [table, rows] of Object.entries(data.tables ?? {})) {
    if (!known.has(table) || !rows.length) continue;
    const cols = (d.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
    for (const row of rows) upsertRow(d, table, cols, row);
  }
  d.exec("COMMIT; PRAGMA foreign_keys = ON;");
}

function upsertRow(d: DatabaseSync, table: string, cols: string[], row: Record<string, unknown>) {
  const keys = Object.keys(row).filter((k) => cols.includes(k));
  d.prepare(`INSERT OR REPLACE INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`).run(...keys.map((k) => row[k] as string | number | null));
}

export function snapshot(d: DatabaseSync): Snapshot {
  return {
    format: "cerealbox-store-v1",
    saved_at: new Date().toISOString(),
    tables: Object.fromEntries(tables(d).map((t) => [t, d.prepare(`SELECT * FROM ${t}`).all() as Record<string, unknown>[]])),
  };
}

/* ---------- Local JSON file ---------- */
function persistOnWrite(d: DatabaseSync, file: string | null) {
  if (!file || remoteConfigured()) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let inTx = 0;
  let dirty = false;
  const save = () => {
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(snapshot(d), null, 1));
    fs.renameSync(tmp, file); // atomic replace: a crash never leaves a half-written file
    dirty = false;
  };
  const changed = () => (inTx ? (dirty = true) : save());

  const prepare = d.prepare.bind(d);
  d.prepare = ((sql: string) => {
    const st = prepare(sql);
    if (/^\s*(INSERT|UPDATE|DELETE|REPLACE)/i.test(sql)) {
      const runStmt = st.run.bind(st);
      st.run = ((...args: Parameters<typeof runStmt>) => {
        const r = runStmt(...args);
        if (r.changes) changed();
        return r;
      }) as typeof st.run;
    }
    return st;
  }) as typeof d.prepare;

  const exec = d.exec.bind(d);
  d.exec = ((sql: string) => {
    const s = sql.trim().toUpperCase();
    if (s.startsWith("BEGIN")) inTx++;
    exec(sql);
    if (s.startsWith("COMMIT")) {
      inTx = Math.max(0, inTx - 1);
      if (!inTx && dirty) save();
    } else if (s.startsWith("ROLLBACK")) {
      inTx = Math.max(0, inTx - 1);
      dirty = false;
    } else if (/(INSERT|UPDATE|DELETE)\s/.test(s) && !s.startsWith("PRAGMA")) changed();
  }) as typeof d.exec;
}

/* ---------- Turso (shared store for serverless) ---------- */

/** Records which rows this function changed, so saves can be merged with other functions' saves. */
function installChangeTracking(d: DatabaseSync) {
  d.exec("CREATE TABLE IF NOT EXISTS _changes (tbl TEXT NOT NULL, row_id INTEGER NOT NULL, op TEXT NOT NULL)");
  for (const t of tables(d)) {
    d.exec(`
      CREATE TRIGGER IF NOT EXISTS _ci_${t} AFTER INSERT ON ${t} BEGIN INSERT INTO _changes VALUES ('${t}', NEW.id, 'u'); END;
      CREATE TRIGGER IF NOT EXISTS _cu_${t} AFTER UPDATE ON ${t} BEGIN INSERT INTO _changes VALUES ('${t}', NEW.id, 'u'); END;
      CREATE TRIGGER IF NOT EXISTS _cd_${t} AFTER DELETE ON ${t} BEGIN INSERT INTO _changes VALUES ('${t}', OLD.id, 'd'); END;`);
  }
  d.exec("DELETE FROM _changes"); // rows loaded from the snapshot aren't local changes
}

type HranaValue = { type: string; value?: string };
type HranaResult = { cols: { name: string }[]; rows: HranaValue[][]; affected_row_count: number };

/** Minimal Turso HTTP (Hrana v2 pipeline) client: no extra dependency. */
async function turso(stmts: { sql: string; args?: (string | number)[] }[]): Promise<HranaResult[]> {
  const base = process.env.TURSO_DATABASE_URL!.replace(/^libsql:\/\//, "https://").replace(/\/$/, "");
  const res = await fetch(`${base}/v2/pipeline`, {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.TURSO_AUTH_TOKEN ?? ""}`, "content-type": "application/json" },
    body: JSON.stringify({
      requests: [
        ...stmts.map((s) => ({
          type: "execute",
          stmt: { sql: s.sql, args: (s.args ?? []).map((a) => (typeof a === "number" ? { type: "integer", value: String(a) } : { type: "text", value: a })) },
        })),
        { type: "close" },
      ],
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Turso HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  const body = (await res.json()) as { results: { type: string; response?: { result: HranaResult }; error?: { message: string } }[] };
  return body.results.slice(0, stmts.length).map((r) => {
    if (r.type !== "ok" || !r.response) throw new Error(`Turso: ${r.error?.message ?? "request failed"}`);
    return r.response.result;
  });
}

const cell = (v: HranaValue | undefined) => (v && v.type !== "null" ? v.value : undefined);

async function ensureRemoteTable() {
  await turso([{ sql: "CREATE TABLE IF NOT EXISTS cerealbox_store (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL, data TEXT NOT NULL)" }]);
}

let tableReady: Promise<void> | null = null;

/** Load the latest shared data. Call at the start of every page, action and background job. */
export async function syncStore(): Promise<void> {
  if (!remoteConfigured()) return;
  tableReady ??= ensureRemoteTable().catch((e) => {
    tableReady = null;
    throw e;
  });
  await tableReady;
  const local = getDb();
  const [r] = await turso([{ sql: "SELECT version, CASE WHEN version != ? THEN data END FROM cerealbox_store WHERE id = 1", args: [remoteVersion] }]);
  if (!r.rows.length) {
    // First use anywhere: publish this store as version 1 (another function may win the race; then just sync again).
    const [ins] = await turso([{ sql: "INSERT OR IGNORE INTO cerealbox_store (id, version, data) VALUES (1, 1, ?)", args: [JSON.stringify(snapshot(local))] }]);
    if (ins.affected_row_count === 1) {
      remoteVersion = 1;
      local.exec("DELETE FROM _changes");
      return;
    }
    return syncStore();
  }
  // Unsaved local changes are merged onto the latest shared version by flushStore.
  if (pendingChanges()) return flushStore();
  const version = Number(cell(r.rows[0][0]));
  const data = cell(r.rows[0][1]);
  if (version !== remoteVersion && data) {
    db = openStore(null, JSON.parse(data) as Snapshot, true);
    remoteVersion = version;
  }
}

function pendingChanges() {
  return !!db && remoteConfigured() && (db.prepare("SELECT COUNT(*) n FROM _changes").get() as { n: number }).n > 0;
}

/** Save this function's changes to the shared store, merging with anything saved meanwhile. */
export async function flushStore(attempt = 0): Promise<void> {
  if (!remoteConfigured() || !pendingChanges()) return;
  const local = db!;
  // Fast path: nobody else saved since we loaded.
  const [u] = await turso([{ sql: "UPDATE cerealbox_store SET data = ?, version = version + 1 WHERE id = 1 AND version = ?", args: [JSON.stringify(snapshot(local)), remoteVersion] }]);
  if (u.affected_row_count === 1) {
    remoteVersion += 1;
    local.exec("DELETE FROM _changes");
    return;
  }
  if (attempt >= 4) throw new Error("Couldn't save: the shared store kept changing. Please try again.");
  // Someone else saved: start from their version and re-apply only the rows we changed.
  const [r] = await turso([{ sql: "SELECT version, data FROM cerealbox_store WHERE id = 1" }]);
  if (!r.rows.length) {
    remoteVersion = -1;
    return syncStore();
  }
  const merged = openStore(null, JSON.parse(cell(r.rows[0][1]) ?? "{}") as Snapshot, true);
  const last = new Map<string, { tbl: string; row_id: number; op: string }>();
  for (const c of local.prepare("SELECT tbl, row_id, op FROM _changes ORDER BY rowid").all() as { tbl: string; row_id: number; op: string }[]) last.set(`${c.tbl}:${c.row_id}`, c);
  merged.exec("PRAGMA foreign_keys = OFF");
  for (const c of last.values()) {
    if (c.op === "d") merged.prepare(`DELETE FROM ${c.tbl} WHERE id = ?`).run(c.row_id);
    else {
      const row = local.prepare(`SELECT * FROM ${c.tbl} WHERE id = ?`).get(c.row_id) as Record<string, unknown> | undefined;
      if (row) upsertRow(merged, c.tbl, Object.keys(row), row);
    }
  }
  merged.exec("PRAGMA foreign_keys = ON");
  // The re-applied rows are recorded in merged's own change log by its triggers, so saving it carries them over.
  db = merged;
  remoteVersion = Number(cell(r.rows[0][0]));
  return flushStore(attempt + 1);
}

/** Test hook: reset the module state. */
export function __resetStoreForTests() {
  db = null;
  remoteVersion = -1;
  tableReady = null;
}

export function tx<T>(fn: () => T): T {
  const d = getDb();
  d.exec("BEGIN");
  try {
    const r = fn();
    d.exec("COMMIT");
    return r;
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
}

export const now = () => new Date().toISOString();
