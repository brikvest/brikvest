/**
 * Backfill `investment_reservations.unit_type_label` for historical sales.
 *
 * The `unitTypeLabel` column is only populated for reservations created after
 * it was introduced. Older sales fall back to price-bucket matching in the
 * developer Sales tab's "Sold vs Remaining by unit type" chart, which gets
 * confused when two unit types share a price (or a developer edits a type's
 * price after sales have happened).
 *
 * Strategy (per property):
 *   1. Load the property's configured `unitTypes` ([{ label, quantity, price }]).
 *   2. For each reservation with no `unitTypeLabel`, look up the unit type whose
 *      `price` matches the reservation's `unit_price_snapshot`.
 *   3. If exactly one unit type matches that price → assign the label.
 *   4. If multiple unit types share that price → log it for manual review (the
 *      attribution is genuinely ambiguous from the data alone).
 *   5. If no unit type matches → log it (price drift / type deleted).
 *
 * Usage:
 *   npx tsx scripts/backfill-unit-type-labels.ts            # dry-run
 *   npx tsx scripts/backfill-unit-type-labels.ts --apply    # actually write
 */
import { db } from "../server/db";
import { properties, investmentReservations } from "../shared/schema";
import { and, eq, isNull, sql } from "drizzle-orm";

type UnitTypeRow = { label: string; quantity: number; price: number };

interface AmbiguousRow {
  reservationId: number;
  propertyId: number;
  propertyName: string;
  unitPriceSnapshot: number;
  candidates: string[];
}

interface UnmatchedRow {
  reservationId: number;
  propertyId: number;
  propertyName: string;
  unitPriceSnapshot: number;
  configuredPrices: number[];
}

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(
    `\n[BACKFILL] unit_type_label — mode: ${apply ? "APPLY (writes)" : "DRY-RUN (no writes)"}\n`,
  );

  const allProperties = await db.select().from(properties);

  let totalAssigned = 0;
  let totalSkippedNoTypes = 0;
  let totalAlreadyLabeled = 0;
  const ambiguous: AmbiguousRow[] = [];
  const unmatched: UnmatchedRow[] = [];

  for (const property of allProperties) {
    const unitTypes: UnitTypeRow[] = Array.isArray(property.unitTypes)
      ? (property.unitTypes as UnitTypeRow[])
      : [];

    // Build price → labels index for this property.
    const priceToLabels = new Map<number, string[]>();
    for (const t of unitTypes) {
      const price = Number(t.price);
      if (!Number.isFinite(price)) continue;
      const label = String(t.label || "").trim();
      if (!label) continue;
      const existing = priceToLabels.get(price) || [];
      existing.push(label);
      priceToLabels.set(price, existing);
    }

    const reservations = await db
      .select()
      .from(investmentReservations)
      .where(
        and(
          eq(investmentReservations.propertyId, property.id),
          eq(investmentReservations.status, "converted_to_investment"),
        ),
      );

    const unlabeled = reservations.filter((r) => !r.unitTypeLabel);
    totalAlreadyLabeled += reservations.length - unlabeled.length;

    if (unlabeled.length === 0) continue;

    if (priceToLabels.size === 0) {
      // Property has no unit-type breakdown; can't attribute.
      totalSkippedNoTypes += unlabeled.length;
      continue;
    }

    for (const r of unlabeled) {
      const priceSnap = Number(r.unitPriceSnapshot);
      const candidates = priceToLabels.get(priceSnap) || [];

      if (candidates.length === 0) {
        unmatched.push({
          reservationId: r.id,
          propertyId: property.id,
          propertyName: property.name,
          unitPriceSnapshot: priceSnap,
          configuredPrices: Array.from(priceToLabels.keys()),
        });
        continue;
      }

      if (candidates.length > 1) {
        ambiguous.push({
          reservationId: r.id,
          propertyId: property.id,
          propertyName: property.name,
          unitPriceSnapshot: priceSnap,
          candidates,
        });
        continue;
      }

      const label = candidates[0];
      if (apply) {
        await db
          .update(investmentReservations)
          .set({ unitTypeLabel: label })
          .where(
            and(
              eq(investmentReservations.id, r.id),
              isNull(investmentReservations.unitTypeLabel),
            ),
          );
      }
      totalAssigned += 1;
    }
  }

  console.log("=".repeat(72));
  console.log("Summary");
  console.log("=".repeat(72));
  console.log(`  Properties scanned:           ${allProperties.length}`);
  console.log(`  Reservations already labeled: ${totalAlreadyLabeled}`);
  console.log(
    `  Reservations ${apply ? "updated" : "would be updated"}:  ${totalAssigned}`,
  );
  console.log(`  Skipped (no unit types):      ${totalSkippedNoTypes}`);
  console.log(`  Ambiguous (price ties):       ${ambiguous.length}`);
  console.log(`  Unmatched (no price match):   ${unmatched.length}`);

  if (ambiguous.length > 0) {
    console.log("\n" + "-".repeat(72));
    console.log(
      "Ambiguous — multiple unit types share this price; resolve manually:",
    );
    console.log("-".repeat(72));
    for (const a of ambiguous) {
      console.log(
        `  reservation #${a.reservationId}  property #${a.propertyId} (${a.propertyName})  price=${a.unitPriceSnapshot}  candidates: ${a.candidates.join(", ")}`,
      );
    }
    console.log(
      "\n  To resolve manually, run e.g.:",
    );
    console.log(
      `    UPDATE investment_reservations SET unit_type_label = '<label>' WHERE id = <id>;`,
    );
  }

  if (unmatched.length > 0) {
    console.log("\n" + "-".repeat(72));
    console.log(
      "Unmatched — reservation price doesn't match any configured unit type:",
    );
    console.log("-".repeat(72));
    for (const u of unmatched) {
      console.log(
        `  reservation #${u.reservationId}  property #${u.propertyId} (${u.propertyName})  price=${u.unitPriceSnapshot}  configured: [${u.configuredPrices.join(", ")}]`,
      );
    }
  }

  if (!apply && totalAssigned > 0) {
    console.log(
      `\n[DRY-RUN] Re-run with --apply to write ${totalAssigned} label assignment(s).`,
    );
  }

  // Coverage report — useful to decide when the legacy price-bucket fallback
  // in the rollup endpoint can be dropped.
  const coverageRows = await db
    .select({
      total: sql<number>`count(*)::int`,
      labeled: sql<number>`count(*) filter (where ${investmentReservations.unitTypeLabel} is not null)::int`,
    })
    .from(investmentReservations)
    .where(eq(investmentReservations.status, "converted_to_investment"));
  const cov = coverageRows[0];
  if (cov && cov.total > 0) {
    const pct = Math.round((cov.labeled / cov.total) * 100);
    console.log(
      `\nConfirmed-sale coverage: ${cov.labeled}/${cov.total} (${pct}%) carry a unit_type_label.`,
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[BACKFILL] Failed:", err);
    process.exit(1);
  });
