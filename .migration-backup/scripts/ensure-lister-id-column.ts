import { sql } from "drizzle-orm";
import { db } from "../server/db";

async function main() {
  // Create the new column explicitly before drizzle-kit inspects the schema.
  // This avoids its interactive "create or rename?" prompt in post-merge setup.
  await db.execute(sql`
    ALTER TABLE properties
    ADD COLUMN IF NOT EXISTS lister_id integer
  `);
  await db.execute(sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'properties_lister_id_users_id_fk'
      ) THEN
        ALTER TABLE properties
        ADD CONSTRAINT properties_lister_id_users_id_fk
        FOREIGN KEY (lister_id) REFERENCES users(id);
      END IF;
    END
    $$
  `);
  console.log("Confirmed properties.lister_id and its foreign key exist.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });