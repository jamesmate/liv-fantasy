import "dotenv/config";
import { Pool, QueryResult, QueryResultRow } from "pg";

// Loads backend/.env (via "dotenv/config" above) before this file does
// anything else, since every script in this project (migrate.ts,
// index.ts) imports from here first. Without this, process.env.DATABASE_URL
// is always undefined and `pg` silently falls back to connecting to
// localhost - which is exactly the ECONNREFUSED ::1/127.0.0.1 error this
// produces if dotenv isn't loaded.

// Supabase (or any Postgres) connection string, set via env var on Render.
// Example: postgres://user:password@host:5432/postgres
if (!process.env.DATABASE_URL) {
  console.error(
    "DATABASE_URL is not set. Check that backend/.env exists and contains a DATABASE_URL line, " +
      "and that you're running npm commands from inside the backend/ folder."
  );
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("supabase") ? { rejectUnauthorized: false } : undefined,
});

export async function query<T extends QueryResultRow = any>(
  text: string,
  params?: unknown[]
): Promise<QueryResult<T>> {
  return pool.query<T>(text, params);
}

export async function withTransaction<T>(fn: (client: import("pg").PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

export default pool;
