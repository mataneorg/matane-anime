import Database from 'better-sqlite3';
import { type BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

/** `$client` is the underlying better-sqlite3 handle, for the few queries that are clearer as SQL. */
export type AppDatabase = BetterSQLite3Database<typeof schema> & { $client: Database.Database };

export interface DatabaseConnection {
  sqlite: Database.Database;
  db: AppDatabase;
}

export function openDatabase(filename: string): DatabaseConnection {
  const sqlite = new Database(filename);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  return { sqlite, db: drizzle(sqlite, { schema, casing: 'snake_case' }) };
}
