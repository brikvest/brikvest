import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFile, mkdir, lstat, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { assertRuntimeFence } from "./config.mjs";

export let db;
export let database;
let initializing;
// Build bundles this module into generated-artifacts: use the same fixed path
// relative to the process working directory, never a DB URL or caller argument.
export async function initializeDatabase() {
  if (initializing) return initializing;
  initializing = (async () => {
    assertRuntimeFence();
    const workspace = process.env.BRIKVEST_SANDBOX_WORKSPACE;
    // The sandbox build injects this fixed path, never an operator-supplied URL.
    if (workspace !== undefined) throw new Error("Database directory overrides are forbidden.");
    const directory = SANDBOX_DATABASE_DIRECTORY;
    await assertLocalDirectory(path.dirname(directory));
    await assertLocalDirectory(directory);
    const marker = path.join(directory, "sandbox-identity.json");
    const expected = '{"purpose":"brikvest-synthetic-checkout-v1"}';
    let markerValue;
    try {
      if ((await lstat(marker)).isSymbolicLink()) throw new Error("Symlink identity refused.");
      markerValue = await readFile(marker, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      if ((await readdir(directory)).length) throw new Error("Unidentified database directory refused.");
      await writeFile(marker, expected, { flag: "wx", mode: 0o600 });
    }
    if (markerValue !== undefined && markerValue !== expected) throw new Error("Database identity mismatch.");
    try {
      const stat = await lstat(path.join(directory, "pg"));
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("Unsafe embedded database path.");
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    // PGlite is an embedded engine, not a network driver. No connection URL,
    // external server, normal pool, fallback or environment database is read.
    database = new PGlite(path.join(directory, "pg"));
    await database.waitReady;
    const exists = (await database.query("SELECT to_regclass('public.sandbox_identity') IS NOT NULL AS installed")).rows[0].installed;
    if (!exists) {
      const tables = (await database.query("SELECT tablename FROM pg_tables WHERE schemaname='public'")).rows;
      if (tables.length) throw new Error("Non-sandbox tables refused.");
      await database.exec(await readFile(SANDBOX_SCHEMA_PATH, "utf8"));
      await database.exec(await readFile(SANDBOX_GATEWAY_SCHEMA_PATH, "utf8"));
      // Financial approval and mail outboxes are not available at all.
      await database.exec("DROP TABLE flutterwave_confirmation_jobs");
    }
    const identity = (await database.query("SELECT purpose FROM sandbox_identity")).rows;
    if (identity.length !== 1 || identity[0].purpose !== "brikvest-synthetic-checkout-v1")
      throw new Error("Embedded database identity mismatch.");
    const violations = (await database.query(`SELECT
      (SELECT count(*) FROM users WHERE email !~ '^synthetic-[a-f0-9]{32}@example[.]test$') +
      (SELECT count(*) FROM flutterwave_attempts WHERE mode<>'test') AS n`)).rows[0];
    if (Number(violations.n)) throw new Error("Non-synthetic database records refused.");
    await database.exec(`ALTER TABLE flutterwave_attempts DROP CONSTRAINT IF EXISTS sandbox_test_only;
      ALTER TABLE flutterwave_attempts ADD CONSTRAINT sandbox_test_only CHECK(mode='test');
      ALTER TABLE flutterwave_attempts DROP CONSTRAINT IF EXISTS sandbox_fixed_charge;
      ALTER TABLE flutterwave_attempts ADD CONSTRAINT sandbox_fixed_charge CHECK(expected_amount=1200.10 AND expected_currency='NGN');
      ALTER TABLE flutterwave_attempts DROP CONSTRAINT IF EXISTS sandbox_no_approval;
      ALTER TABLE flutterwave_attempts ADD CONSTRAINT sandbox_no_approval CHECK(state<>'approved');`);
    db = drizzle(database);
    return { database, db };
  })();
  return initializing;
}
async function assertLocalDirectory(directory) {
  try {
    const stat = await lstat(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("Unsafe sandbox storage directory.");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await mkdir(directory, { mode: 0o700 });
  }
}
