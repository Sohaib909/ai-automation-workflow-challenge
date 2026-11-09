import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openStore } from "@/lib/db";

describe("JSON file store", () => {
  it("saves after each write, saves once per transaction, and reloads everything", () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "cb-")), "store.json");
    const a = openStore(file);
    const ts = new Date().toISOString();
    const id = Number(a.prepare("INSERT INTO clients (name, sector, created_at) VALUES (?,?,?)").run("Acme", "Retail", ts).lastInsertRowid);
    expect(JSON.parse(fs.readFileSync(file, "utf8")).tables.clients).toHaveLength(1);

    a.exec("BEGIN");
    const k = Number(a.prepare("INSERT INTO campaigns (client_id, name, objective, created_at) VALUES (?,?,?,?)").run(id, "Spring", "Sales", ts).lastInsertRowid);
    a.prepare("INSERT INTO briefs (campaign_id, version, product, audience, created_at) VALUES (?,?,?,?,?)").run(k, 1, "Tea", "UK", ts);
    expect(JSON.parse(fs.readFileSync(file, "utf8")).tables.campaigns).toHaveLength(0); // not yet: inside the transaction
    a.exec("COMMIT");
    expect(JSON.parse(fs.readFileSync(file, "utf8")).tables.briefs).toHaveLength(1);

    a.exec("BEGIN");
    a.prepare("DELETE FROM briefs").run();
    a.exec("ROLLBACK");

    const b = openStore(file); // simulates a restart
    expect(b.prepare("SELECT name FROM clients").all()).toEqual([{ name: "Acme" }]);
    expect((b.prepare("SELECT COUNT(*) n FROM briefs").get() as { n: number }).n).toBe(1);
    // ids keep counting up after a reload
    expect(Number(b.prepare("INSERT INTO clients (name, sector, created_at) VALUES (?,?,?)").run("Beta", "x", ts).lastInsertRowid)).toBe(id + 1);
    expect(fs.existsSync(`${file}.tmp`)).toBe(false);
  });
});
