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

function openDatabase(file: string): DB {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new Database(file);
  if (file !== ":memory:") db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.exec(loadSchemaSql());
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
