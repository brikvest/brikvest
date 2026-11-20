import { readFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { db } from "../server/db";

async function main() {
  const migration = await readFile(new URL("./ensure-property-listing-details.sql", import.meta.url), "utf8");
  await db.execute(sql.raw(migration));
  console.log("Confirmed optional property listing-detail columns exist.");
}

main().then(() => process.exit(0)).catch(() => {
  console.error("Could not add property listing-detail columns.");
  process.exit(1);
});
