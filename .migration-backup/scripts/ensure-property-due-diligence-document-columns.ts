import { sql } from "drizzle-orm";
import { db } from "../server/db";

async function main() {
  await db.execute(sql`
    ALTER TABLE properties
      ADD COLUMN IF NOT EXISTS due_diligence_document_name text,
      ADD COLUMN IF NOT EXISTS due_diligence_document_url text
  `);

  console.log("Confirmed property due diligence document columns exist.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });