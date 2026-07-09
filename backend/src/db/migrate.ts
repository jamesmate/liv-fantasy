/**
 * Minimal migration runner. Run with `npm run migrate` after setting
 * DATABASE_URL. Applies schema.sql then triggers_and_views.sql, in
 * order, every time - all statements use `create ... if not exists` or
 * `create or replace` so this is safe to re-run.
 *
 * Each file's statements run inside an explicit transaction, so a
 * failure partway through one file (e.g. a SQL syntax error) rolls
 * back that whole file's changes rather than leaving the database in
 * a half-migrated state. This also means a failed run is always safe
 * to fix and re-run - nothing partial is left behind.
 */
import fs from "fs";
import path from "path";
import pool from "./client";

async function run() {
  const files = ["schema.sql", "triggers_and_views.sql"];
  for (const file of files) {
    const sql = fs.readFileSync(path.join(__dirname, file), "utf-8");
    console.log(`Applying ${file}...`);
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("commit");
    } catch (err) {
      await client.query("rollback");
      console.error(`\nFailed while applying ${file} - no changes from this file were kept.`);
      throw err;
    } finally {
      client.release();
    }
  }
  console.log("Migration complete.");
  await pool.end();
}

run().catch((err) => {
  console.error("Migration failed:", err.message || err);
  process.exit(1);
});
