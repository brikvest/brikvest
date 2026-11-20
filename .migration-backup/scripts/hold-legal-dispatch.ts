/**
 * Temporary session-only maintenance pause. No DDL or business-row writes.
 * Keep running through publication; release only after the published persistent
 * pause has been independently verified. Never import the application backend.
 */
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";

neonConfig.webSocketConstructor = ws;
const expectedEvidence = process.env.EXPECTED_LEGAL_EVIDENCE_FINGERPRINT;
const expectedGuards = process.env.EXPECTED_LEGAL_GUARDS_FINGERPRINT;
if (!expectedEvidence || !expectedGuards || !process.env.NEON_DATABASE_URL) {
  throw new Error("Verified target fingerprints and the secure connection are required.");
}
const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL, max: 1, connectionTimeoutMillis: 10000 });
const client = await pool.connect();
const identitySql = `SELECT current_database() AS db,
  (SELECT md5(string_agg(id::text || ':' || coalesce(unsigned_pdf_sha256,'') || ':' ||
    coalesce(signed_pdf_sha256,''),'|' ORDER BY id))
    FROM (SELECT id,unsigned_pdf_sha256,signed_pdf_sha256 FROM legal_documents ORDER BY id LIMIT 200) d) AS evidence,
  (SELECT md5(string_agg(p.proname || ':' || pg_get_functiondef(p.oid),'|' ORDER BY p.proname))
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname LIKE 'legal_guard_%') AS guards`;
let transaction = false;
try {
  const target = (await client.query(identitySql)).rows[0];
  if (target?.db !== "neondb" || target.evidence !== expectedEvidence || target.guards !== expectedGuards) {
    throw new Error("Target identity does not match independently verified production.");
  }
  // Pin the physical backend even when the secure URL uses a transaction pooler.
  // Read identity before BEGIN so this transaction never locks legal_documents.
  await client.query("BEGIN READ ONLY");
  transaction = true;
  const acquired = (await client.query("SELECT pg_try_advisory_xact_lock($1,$2) AS acquired", [1279608641, 1])).rows[0]?.acquired === true;
  if (!acquired) throw new Error("Maintenance permit is unavailable; no setup was changed.");
  const leases = await client.query("SELECT count(*)::int AS active FROM legal_jobs WHERE status='leased' AND leased_until>now()");
  if (leases.rows[0]?.active !== 0) throw new Error("An active legal lease remains; no setup was changed.");
  console.log("VERIFIED_PRODUCTION_LEGAL_DISPATCH_PAUSED: exclusive maintenance permit held; no active leases.");
  for (;;) {
    await new Promise(resolve => setTimeout(resolve, 10000));
    const held = (await client.query(`SELECT EXISTS(SELECT 1 FROM pg_locks
      WHERE pid=pg_backend_pid() AND locktype='advisory' AND classid=1279608641
      AND objid=1 AND mode='ExclusiveLock' AND granted) AS held`)).rows[0]?.held;
    if (held !== true) throw new Error("Maintenance permit was lost.");
  }
} catch {
  console.error("LEGAL_MAINTENANCE_FAILED: do not publish schema changes until the pause is reverified.");
  process.exitCode = 1;
} finally {
  if (transaction) await client.query("ROLLBACK").catch(() => {});
  client.release(true);
  await pool.end();
}