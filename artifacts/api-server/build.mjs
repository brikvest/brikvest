// Compile only. Never import the application, connect to the DB, or run DDL.
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
await build({
  absWorkingDir: root,
  entryPoints: ["artifacts/api-server/src/index.ts"],
  outfile: "artifacts/api-server/dist/index.mjs",
  platform: "node",
  packages: "external",
  bundle: true,
  format: "esm",
  alias: { "@shared": path.join(root, "shared") },
});
