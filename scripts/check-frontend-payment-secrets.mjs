// Fails the web build if the bundle contains a Flutterwave key prefix or any
// server-only payment setting name. Reads files only; prints paths, never content.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../artifacts/brikvest/dist/public", import.meta.url));
const forbidden = /FLWSECK|FLWPUBK|FLW_SECRET|FLW_ENABLED|FLW_LIVE_AUTHORIZED|FLW_WORKER_ENABLED|FLW_NOTIFICATION_DISPATCH|FLW_MODE|VITE_FLW|BRIKVEST_TEST_FLW/;
const offenders = [];
let files = 0;
for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
  if (!entry.isFile() || !/\.(?:js|mjs|css|html|json|map|txt)$/.test(entry.name)) continue;
  files++;
  const file = path.join(entry.parentPath, entry.name);
  if (forbidden.test(await readFile(file, "utf8"))) offenders.push(path.relative(root, file));
}
if (!files) throw new Error("No built web files found to check.");
if (offenders.length) {
  console.error("Payment secret or switch reference found in the web bundle:", offenders.join(", "));
  process.exit(1);
}
console.info(`Web bundle payment-secret check passed (${files} files).`);
