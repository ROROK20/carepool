import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { getEnv } from "./env";

/**
 * SQLite access. Adapted from Dispute Defender's `src/lib/db.ts` (same
 * author, MIT): the singleton on globalThis (survives Next.js hot reload),
 * WAL, foreign keys, busy timeout and the schema-on-open pattern are that
 * file's.
 */

export type DB = Database.Database;

const g = globalThis as unknown as { __cpDb?: DB };

export function loadSchemaSql(): string {
  const file = path.resolve(process.cwd(), "db", "schema.sql");
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    throw new Error(`db/schema.sql not found at ${file}. Run commands from the project root.`);
  }
}

/** Bump when db/schema.sql changes shape, and add the step to migrate(). */
export const SCHEMA_VERSION = 2;

/**
 * Bring an existing database up to SCHEMA_VERSION. `CREATE TABLE IF NOT
 * EXISTS` never changes a table that already exists, so a changed table is
 * handled here. Version 2: explanations store sentences_json (each sentence
 * with its own quote) instead of one text/quote pair; explanations are
 * derived data, so the old table is dropped and rebuilt empty.
 */
export function migrate(db: DB): void {
  const version = db.pragma("user_version", { simple: true }) as number;
  if (version < 2) {
    const cols = db.prepare("PRAGMA table_info(explanations)").all() as { name: string }[];
    if (cols.length > 0 && !cols.some((c) => c.name === "sentences_json")) {
      db.exec("DROP TABLE explanations");
      db.exec(loadSchemaSql());
    }
  }
  if (version < SCHEMA_VERSION) db.pragma(`user_version = ${SCHEMA_VERSION}`);
}

function openDatabase(file: string): DB {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new Database(file);
  if (file !== ":memory:") db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.exec(loadSchemaSql());
  migrate(db);
  return db;
}

/** Process-wide singleton. */
export function getDb(): DB {
  if (g.__cpDb && g.__cpDb.open) return g.__cpDb;
  g.__cpDb = openDatabase(getEnv().DATABASE_PATH);
  return g.__cpDb;
}

export function closeDb(): void {
  if (g.__cpDb && g.__cpDb.open) g.__cpDb.close();
  g.__cpDb = undefined;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function tx<T>(fn: (db: DB) => T): T {
  const db = getDb();
  return db.transaction(() => fn(db))();
}

export function parseJson<T>(text: string | null | undefined, fallback: T): T {
  if (text === null || text === undefined || text === "") return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}
