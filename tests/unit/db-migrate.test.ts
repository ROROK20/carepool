import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { loadSchemaSql, migrate, SCHEMA_VERSION } from "@/lib/db";

describe("database migration", () => {
  it("rebuilds a version-1 explanations table (text/quote columns) so new explanations can be stored", () => {
    const db = new Database(":memory:");
    db.exec(
      "CREATE TABLE explanations (flag_id TEXT PRIMARY KEY, text TEXT NOT NULL, quote TEXT NOT NULL, model TEXT, provider TEXT NOT NULL, created_at TEXT NOT NULL)",
    );
    db.prepare("INSERT INTO explanations VALUES ('f', 't', 'q', null, 'mock', 'now')").run();
    db.exec(loadSchemaSql());
    migrate(db);
    const cols = (db.prepare("PRAGMA table_info(explanations)").all() as { name: string }[]).map((c) => c.name);
    expect(cols).toContain("sentences_json");
    expect(cols).not.toContain("text");
    expect(db.pragma("user_version", { simple: true })).toBe(SCHEMA_VERSION);
    db.prepare("INSERT INTO explanations (flag_id, sentences_json, model, provider, created_at) VALUES ('f', '[]', null, 'mock', 'now')").run();
  });

  it("leaves a current database alone", () => {
    const db = new Database(":memory:");
    db.exec(loadSchemaSql());
    migrate(db);
    db.prepare("INSERT INTO explanations (flag_id, sentences_json, model, provider, created_at) VALUES ('f', '[]', null, 'mock', 'now')").run();
    migrate(db);
    expect((db.prepare("SELECT COUNT(*) AS n FROM explanations").get() as { n: number }).n).toBe(1);
  });
});
