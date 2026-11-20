/**
 * Idempotent backfill: copy properties.developer_id into the new dedicated
 * properties.lister_id for rows that don't have a lister yet, so existing
 * "Listed by" attributions keep displaying exactly as before while display
 * attribution is decoupled from developer-portal ownership.
 *
 * Only fills NULL lister_id values — never overwrites an explicit lister and
 * never touches developer_id, so ownership/permissions are unaffected.
 * Safe to re-run.
 *
 * Run with: npx tsx scripts/backfill-lister-id.ts
 */
import { db } from "../server/db";
import { properties } from "../shared/schema";
import { and, isNull, isNotNull, sql } from "drizzle-orm";

async function main() {
  const updated = await db
    .update(properties)
    .set({ listerId: sql`${properties.developerId}` })
    .where(and(isNull(properties.listerId), isNotNull(properties.developerId)))
    .returning({ id: properties.id, developerId: properties.developerId, listerId: properties.listerId });
  console.log(`Backfilled lister_id on ${updated.length} propert${updated.length === 1 ? "y" : "ies"}:`, updated);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
