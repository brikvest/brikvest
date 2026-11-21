import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

// Never load dotenv. Do not spread process.env into the child. In particular,
// no main/alternate DB, SMTP, shared session, live key, or legal worker settings.
const allowed = [
  "PATH", "HOME", "TMPDIR", "LANG", "PORT", "BASE_PATH", "REPLIT_DEV_DOMAIN",
  "BRIKVEST_TEST_FLW_SECRET_KEY", "BRIKVEST_TEST_FLW_SECRET_HASH",
  "BRIKVEST_TEST_RETURN_ORIGIN", "BRIKVEST_TEST_CALLBACK_APPROVED",
  "BRIKVEST_TEST_PORT_REVIEWED", "BRIKVEST_TEST_MODE",
  "BRIKVEST_TEST_PORT_REVIEW_WAIVED", "BRIKVEST_TEST_CALLBACK_MODE",
  "BRIKVEST_TEST_WEBHOOK_ONLY",
  "BRIKVEST_TEST_PROVIDER_NOTIFICATIONS_DISABLED",
  "BRIKVEST_TEST_PROVIDER_EMAILS_AUTHORIZED",
];
const env = Object.fromEntries(allowed.filter(key => process.env[key] !== undefined)
  .map(key => [key, process.env[key]]));
env.BRIKVEST_SANDBOX_RUNTIME = "synthetic-only-v1";
env.NODE_ENV = "development";
const child = spawn(process.execPath, [fileURLToPath(new URL("./start.mjs", import.meta.url))], {
  cwd: fileURLToPath(new URL("../", import.meta.url)), env, stdio: "inherit",
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", code => { process.exitCode = code ?? 1; });
