import { sql } from "drizzle-orm";
import { db } from "../server/db";

async function main() {
  await db.execute(sql`
    ALTER TABLE properties
      ADD COLUMN IF NOT EXISTS unit_land_cost bigint NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS unit_due_diligence_cost bigint NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS unit_agent_fees bigint NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS unit_service_charge bigint NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS show_unit_cost_breakdown boolean NOT NULL DEFAULT false
  `);

  for (const [name, column] of [
    ["properties_unit_land_cost_nonnegative", "unit_land_cost"],
    ["properties_unit_due_diligence_cost_nonnegative", "unit_due_diligence_cost"],
    ["properties_unit_agent_fees_nonnegative", "unit_agent_fees"],
    ["properties_unit_service_charge_nonnegative", "unit_service_charge"],
  ] as const) {
    await db.execute(sql.raw(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = '${name}'
            AND conrelid = 'public.properties'::regclass
        ) THEN
          ALTER TABLE properties ADD CONSTRAINT ${name} CHECK (${column} >= 0);
        END IF;
      END
      $$
    `));
  }

  console.log("Confirmed property unit-cost transparency columns and constraints exist.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });