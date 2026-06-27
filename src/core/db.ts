import { blob, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { sql } from "drizzle-orm";

// ─── System tables (fixed schema — Drizzle handles these) ────────────────────

export const usersTable = sqliteTable("_just_users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("user"),
  verified: integer("verified", { mode: "boolean" }).notNull().default(false),
  meta: text("meta", { mode: "json" }).$type<Record<string, unknown>>(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const sessionsTable = sqliteTable("_just_sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const collectionsTable = sqliteTable("_just_collections", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  schema: text("schema", { mode: "json" })
    .$type<CollectionSchemaJSON>()
    .notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const migrationsTable = sqliteTable("_just_migrations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  appliedAt: text("applied_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  checksum: text("checksum").notNull(),
});

// ─── Types ───────────────────────────────────────────────────────────────────

export type FieldType =
  | "string"
  | "text"
  | "number"
  | "boolean"
  | "date"
  | "datetime"
  | "json"
  | "relation"
  | "file";

export interface FieldDefinition {
  type: FieldType;
  required?: boolean;
  default?: unknown;
  unique?: boolean;
  collection?: string; // for relation fields
  multiple?: boolean; // for relation fields
}

export interface CollectionSchemaJSON {
  fields: Record<string, FieldDefinition>;
}

// ─── DB singleton ─────────────────────────────────────────────────────────────

let _sqlite: Database | null = null;
let _db: ReturnType<typeof drizzle> | null = null;

export function getDB() {
  if (!_db) throw new Error("DB not initialized. Call initDB() first.");
  return _db;
}

export function getSQLite() {
  if (!_sqlite) throw new Error("SQLite not initialized. Call initDB() first.");
  return _sqlite;
}

export function initDB(path: string = "./one-base.db") {
  _sqlite = new Database(path);

  // Performance pragmas — important for speed
  _sqlite.run("PRAGMA journal_mode = WAL");
  _sqlite.run("PRAGMA synchronous = NORMAL");
  _sqlite.run("PRAGMA foreign_keys = ON");
  _sqlite.run("PRAGMA cache_size = -64000"); // 64MB cache
  _sqlite.run("PRAGMA temp_store = MEMORY");

  _db = drizzle(_sqlite);

  bootstrapSystemTables(_sqlite);

  return _db;
}

// ─── Bootstrap system tables on first run ────────────────────────────────────

function bootstrapSystemTables(sqlite: Database) {
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS _just_users (
      id           TEXT PRIMARY KEY,
      email        TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role         TEXT NOT NULL DEFAULT 'user',
      verified     INTEGER NOT NULL DEFAULT 0,
      meta         TEXT,
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  sqlite.run(`
    CREATE TABLE IF NOT EXISTS _just_sessions (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES _just_users(id) ON DELETE CASCADE,
      token      TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  sqlite.run(`
    CREATE TABLE IF NOT EXISTS _just_collections (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL UNIQUE,
      schema     TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  sqlite.run(`
    CREATE TABLE IF NOT EXISTS _just_migrations (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (datetime('now')),
      checksum   TEXT NOT NULL
    )
  `);
}

// ─── Dynamic collection table helpers ────────────────────────────────────────

export function fieldTypeToSQL(field: FieldDefinition): string {
  const typeMap: Record<FieldType, string> = {
    string: "TEXT",
    text: "TEXT",
    number: "REAL",
    boolean: "INTEGER",
    date: "TEXT",
    datetime: "TEXT",
    json: "TEXT",
    relation: "TEXT",
    file: "TEXT",
  };
  return typeMap[field.type] ?? "TEXT";
}

export function createCollectionTable(
  name: string,
  schema: CollectionSchemaJSON,
) {
  const sqlite = getSQLite();

  const columns = Object.entries(schema.fields)
    .map(([colName, field]) => {
      const sqlType = fieldTypeToSQL(field);
      const notNull = field.required ? " NOT NULL" : "";
      const unique = field.unique ? " UNIQUE" : "";
      const defaultClause =
        field.default !== undefined
          ? ` DEFAULT ${JSON.stringify(field.default)}`
          : "";
      return `  ${colName} ${sqlType}${notNull}${unique}${defaultClause}`;
    })
    .join(",\n");

  sqlite.run(`
    CREATE TABLE IF NOT EXISTS ${name} (
      id         TEXT PRIMARY KEY,
      ${columns},
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

export function dropCollectionTable(name: string) {
  getSQLite().run(`DROP TABLE IF EXISTS ${name}`);
}
