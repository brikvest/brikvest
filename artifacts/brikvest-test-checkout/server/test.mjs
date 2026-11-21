import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
// The regression process receives no workspace secrets at all.
const env = Object.fromEntries(["PATH", "HOME", "TMPDIR", "LANG"].filter(k => process.env[k] !== undefined).map(k => [k, process.env[k]]));
const result = spawnSync(process.execPath, ["--test", fileURLToPath(new URL("../tests/isolation.test.mjs", import.meta.url))], { env, stdio: "inherit" });
process.exitCode = result.status ?? 1;
