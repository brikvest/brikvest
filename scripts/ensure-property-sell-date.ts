import { readFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { db } from "../server/db";

async function main() {
  const migration = await readFile(new URL("./ensure-property-sell-date.sql", import.meta.url), "utf8");
  await db.execute(sql.raw(migration));
  console.log("Confirmed optional property sell_date column exists.");
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
