import { build } from "esbuild";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
export const outputDir = path.join(root, "generated-artifacts/brikvest-test-checkout");
const main = path.join(root, "artifacts/api-server/src");
const here = fileURLToPath(new URL("./", import.meta.url));
const allowedMainFiles = new Set([
  "payments/flutterwave.ts", "payments/gateway-guards.ts",
  "payments/flutterwave-checkout-closure.ts",
  "payments/flutterwave-provider.ts", "legal/application-origin.ts",
].map(file => path.join(main, file)));

export async function buildLifecycle({ regression = false } = {}) {
  const targetDir = regression ? path.join(root, "generated-artifacts/brikvest-test-checkout-regression") : outputDir;
  await mkdir(targetDir, { recursive: true });
  const result = await build({
    stdin: {
      contents: `
        export { initiateCheckout, recheckAttempt, queueVerification, runVerification,
          verifyTransaction, safeAttempt } from "${main}/payments/flutterwave.ts";
        export { closeQueuedCheckouts } from "${main}/payments/flutterwave-checkout-closure.ts";
        export { initializeDatabase, database, db } from "${here}database.mjs";
        export { gatewayConfig, webhookAuthenticated, GatewayError, providerRequest, safeCheckoutUrl, exactAmount } from "${here}provider.mjs";
      `,
      resolveDir: root, loader: "ts",
    },
    bundle: true, platform: "node", format: "esm", packages: "external",
    treeShaking: true, write: false, metafile: true,
    define: {
      SANDBOX_DATABASE_DIRECTORY: JSON.stringify(path.join(targetDir, "database")),
      SANDBOX_SCHEMA_PATH: JSON.stringify(path.join(here, "schema.sql")),
      SANDBOX_GATEWAY_SCHEMA_PATH: JSON.stringify(path.join(targetDir, "gateway.sql")),
    },
    plugins: [{
      name: "sandbox-only-dependencies",
      setup(plugin) {
        plugin.onResolve({ filter: /.*/ }, args => {
          if (args.path === "@sandbox/provider-primitives")
            return { path: path.join(main, "payments/flutterwave-provider.ts") };
          if (!args.importer.startsWith(main)) return;
          if (args.path === "../db") return { path: path.join(here, "database.mjs") };
          if (args.path === "../legal/approval") return { path: "approval-disabled", namespace: "sandbox" };
          if (args.path === "./flutterwave-provider") return { path: path.join(here, "provider.mjs") };
          if (args.path.startsWith(".")) {
            const resolved = path.resolve(path.dirname(args.importer), `${args.path}.ts`);
            if (!allowedMainFiles.has(resolved)) throw new Error("Unexpected main application dependency refused.");
            return { path: resolved };
          }
          if (!["node:crypto", "drizzle-orm", "decimal.js"].includes(args.path))
            throw new Error("Unexpected shared payment dependency refused.");
        });
        plugin.onLoad({ filter: /.*/, namespace: "sandbox" }, () => ({
          contents: `export function confirmInvestmentWithinTransaction() {
            throw new Error("Ownership, approval, legal documents and notifications are disabled in the sandbox.");
          }`,
          loader: "js",
        }));
      },
    }],
  });
  const code = result.outputFiles[0].text;
  // Tree-shaking must remove the main provider config and unreachable approval
  // branch, not merely leave a promise that operators won't invoke them.
  if (/process\.env\.(?:FLW_|DATABASE|SMTP|NEON)|INSERT INTO (?:ownership_certificates|flutterwave_confirmation_jobs)/.test(code))
    throw new Error("Unsafe main configuration or approval branch survived sandbox build.");
  const inputs = Object.keys(result.metafile.inputs);
  if (inputs.some(file => /(?:emailService|notifications|worker|storage|\/db\.ts|legal\/approval|lib\/db\/)/i.test(file)))
    throw new Error("A forbidden application module entered the sandbox import graph.");
  await writeFile(path.join(targetDir, "lifecycle.mjs"), code);
  await writeFile(path.join(targetDir, "imports.json"), JSON.stringify(inputs, null, 2));
  // The exact existing gateway schema is applied ONLY to embedded PGlite.
  await writeFile(path.join(targetDir, "gateway.sql"),
    await readFile(path.join(root, "scripts/ensure-flutterwave.sql"), "utf8"));
  return path.join(targetDir, "lifecycle.mjs");
}
if (process.argv.includes("--build-only")) await buildLifecycle();
