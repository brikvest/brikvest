/**
 * One-off, idempotent backfill: attribute the two live land listings to
 * Charles Giadom (user id 2, giadomcharles@gmail.com) as Land Vendor.
 *
 * Applied to the live database on 2026-08-02 (task: show who listed each
 * property). Safe to re-run; to revert:
 *   UPDATE properties SET developer_id = NULL WHERE id IN (33, 34);
 *   UPDATE users SET lister_type = NULL WHERE id = 2;
 *
 * Run with: npx tsx scripts/backfill-charles-lister.ts
 */
import { db } from "../server/db";
import { properties, users } from "../shared/schema";
import { eq, inArray, isNull, and } from "drizzle-orm";

async function main() {
  const props = await db
    .update(properties)
    .set({ developerId: 2 })
    .where(and(inArray(properties.id, [33, 34]), isNull(properties.developerId)))
    .returning({ id: properties.id });
  const usrs = await db
    .update(users)
    .set({ listerType: "land_vendor" })
    .where(eq(users.id, 2))
    .returning({ id: users.id, listerType: users.listerType });
  console.log("properties updated (only if previously unlinked):", props);
  console.log("user lister_type:", usrs);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
