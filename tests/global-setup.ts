import { spawnSync } from "child_process";

/**
 * Vitest global setup.
 *
 * If `TEST_DATABASE_URL` is set, treat it as the dedicated, isolated test
 * database and (a) push the latest Drizzle schema to it, then (b) truncate
 * every public table so each suite run starts from a known-empty state.
 *
 * If `TEST_DATABASE_URL` is **not** set, log a warning and fall back to the
 * shared `DATABASE_URL` — in that mode the per-suite cleanup helpers
 * (`cleanupAllTestData` and `clearSeedProjects`) are responsible for
 * scoping deletions to test-prefixed and seed-managed rows only.
 */
export default async function setup() {
  const testDbUrl = process.env.TEST_DATABASE_URL;
  const sharedDbUrl = process.env.DATABASE_URL;

  if (!testDbUrl) {
    console.warn(
      "\n[tests] TEST_DATABASE_URL is not set — falling back to DATABASE_URL.",
    );
    console.warn(
      "[tests] Tests will scope cleanup to '__brikvest_test__' rows and the demo seed projects.",
    );
    console.warn(
      "[tests] For full isolation, provision a second Postgres database and export TEST_DATABASE_URL=postgres://...\n",
    );
    if (!sharedDbUrl) {
      throw new Error("Neither TEST_DATABASE_URL nor DATABASE_URL is set.");
    }
    return;
  }

  console.log("[tests] Using isolated TEST_DATABASE_URL — preparing schema…");

  // Push the Drizzle schema to the isolated test database.
  const push = spawnSync(
    "npx",
    ["drizzle-kit", "push", "--config=drizzle.config.ts"],
    {
      stdio: "pipe",
      encoding: "utf-8",
      env: { ...process.env, DATABASE_URL: testDbUrl },
      timeout: 120_000,
    },
  );
  if (push.status !== 0) {
    throw new Error(
      `drizzle-kit push failed (status ${push.status}):\n${push.stdout}\n${push.stderr}`,
    );
  }

  // Truncate every public table so each test run starts from a clean state.
  // We use TRUNCATE … RESTART IDENTITY CASCADE so serial PKs reset and any
  // foreign-key children are wiped in a single statement.
  const { Pool } = await import("@neondatabase/serverless");
  const ws = (await import("ws")).default;
  const { neonConfig } = await import("@neondatabase/serverless");
  neonConfig.webSocketConstructor = ws;
  const pool = new Pool({ connectionString: testDbUrl });
  try {
    const tablesRes = await pool.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
    );
    const names = tablesRes.rows
      .map((r) => `"${r.tablename}"`)
      .filter((n) => !n.includes("__drizzle_migrations"));
    if (names.length > 0) {
      await pool.query(
        `TRUNCATE ${names.join(", ")} RESTART IDENTITY CASCADE`,
      );
    }
    console.log(
      `[tests] Truncated ${names.length} tables in TEST_DATABASE_URL.`,
    );
  } finally {
    await pool.end();
  }
}
