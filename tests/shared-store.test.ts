/**
 * The serverless shared store (Turso), tested against a simulated Turso HTTP API backed by a real SQLite.
 * Simulates what broke on Vercel: separate functions must see each other's data, and concurrent saves
 * must merge instead of overwriting.
 */
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { __resetStoreForTests, flushStore, getDb, openStore, snapshot, syncStore } from "@/lib/db";

const remote = new DatabaseSync(":memory:");
let requests = 0;
const realFetch = globalThis.fetch;

function fakeTurso(_url: string, init: RequestInit) {
  requests++;
  const body = JSON.parse(String(init.body)) as { requests: { type: string; stmt?: { sql: string; args: { type: string; value: string }[] } }[] };
  const results = body.requests.map((r) => {
    if (r.type !== "execute") return { type: "ok", response: { type: r.type } };
    const args = r.stmt!.args.map((a) => (a.type === "integer" ? Number(a.value) : a.value));
    const st = remote.prepare(r.stmt!.sql);
    if (/^\s*SELECT/i.test(r.stmt!.sql)) {
      const rows = st.all(...args) as Record<string, unknown>[];
      const cols = st.columns().map((c) => ({ name: c.name }));
      const enc = (v: unknown) => (v == null ? { type: "null" } : typeof v === "number" ? { type: "integer", value: String(v) } : { type: "text", value: String(v) });
      return { type: "ok", response: { type: "execute", result: { cols, rows: rows.map((row) => cols.map((c) => enc(row[c.name]))), affected_row_count: 0 } } };
    }
    const res = st.run(...args);
    return { type: "ok", response: { type: "execute", result: { cols: [], rows: [], affected_row_count: Number(res.changes) } } };
  });
  return Promise.resolve(new Response(JSON.stringify({ results }), { status: 200, headers: { "content-type": "application/json" } }));
}

/** Another serverless function: loads the shared data, changes something, saves it as a new version. */
function otherFunctionWrites(change: (d: DatabaseSync) => void) {
  const row = remote.prepare("SELECT version, data FROM cerealbox_store WHERE id = 1").get() as { version: number; data: string };
  const d = openStore(null, JSON.parse(row.data));
  change(d);
  remote.prepare("UPDATE cerealbox_store SET data = ?, version = ? WHERE id = 1").run(JSON.stringify(snapshot(d)), row.version + 1);
}

const ts = () => new Date().toISOString();
const names = () => (getDb().prepare("SELECT name FROM clients ORDER BY id").all() as { name: string }[]).map((r) => r.name);

describe("shared store on serverless (Turso)", () => {
  beforeAll(() => {
    process.env.TURSO_DATABASE_URL = "libsql://cerealbox-test.turso.io";
    process.env.TURSO_AUTH_TOKEN = "test-token";
    globalThis.fetch = fakeTurso as typeof fetch;
    __resetStoreForTests();
  });
  afterAll(() => {
    globalThis.fetch = realFetch;
    delete process.env.TURSO_DATABASE_URL;
    delete process.env.TURSO_AUTH_TOKEN;
    __resetStoreForTests();
  });

  it("creates the shared store on first use and saves changes to it", async () => {
    await syncStore();
    expect((remote.prepare("SELECT version FROM cerealbox_store").get() as { version: number }).version).toBe(1);
    getDb().prepare("INSERT INTO clients (name, sector, created_at) VALUES (?,?,?)").run("Acme", "Retail", ts());
    await flushStore();
    const saved = JSON.parse((remote.prepare("SELECT data FROM cerealbox_store").get() as { data: string }).data);
    expect(saved.tables.clients.map((c: { name: string }) => c.name)).toEqual(["Acme"]);
  });

  it("a page in another function sees data saved elsewhere (the bug on Vercel)", async () => {
    otherFunctionWrites((d) => d.prepare("INSERT INTO clients (name, sector, created_at) VALUES (?,?,?)").run("Beta", "Charity", ts()));
    expect(names()).toEqual(["Acme"]); // stale until synced
    await syncStore();
    expect(names()).toEqual(["Acme", "Beta"]);
  });

  it("concurrent saves merge instead of overwriting", async () => {
    // We approve something locally while another function adds a campaign at the same time.
    getDb().prepare("UPDATE clients SET sector = ? WHERE name = ?").run("Retail — updated here", "Acme");
    otherFunctionWrites((d) => d.prepare("INSERT INTO campaigns (client_id, name, objective, created_at) VALUES (2, ?, ?, ?)").run("Spring", "Sales", ts()));
    await flushStore();
    __resetStoreForTests(); // a brand-new function
    await syncStore();
    const d = getDb();
    expect((d.prepare("SELECT sector FROM clients WHERE name = 'Acme'").get() as { sector: string }).sector).toBe("Retail — updated here");
    expect((d.prepare("SELECT name FROM campaigns").all() as { name: string }[]).map((c) => c.name)).toEqual(["Spring"]);
    expect(names()).toEqual(["Acme", "Beta"]);
  });

  it("deletes merge too, and unchanged syncs cost one small request", async () => {
    getDb().prepare("DELETE FROM clients WHERE name = 'Beta'").run();
    otherFunctionWrites((d) => d.prepare("INSERT INTO clients (name, sector, created_at) VALUES (?,?,?)").run("Gamma", "Tea", ts()));
    await flushStore();
    __resetStoreForTests();
    await syncStore();
    expect(names()).toEqual(["Acme", "Gamma"]);
    const before = requests;
    await syncStore();
    expect(requests - before).toBe(1);
  });
});
