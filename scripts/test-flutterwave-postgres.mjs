// Own the entire cluster lifecycle. Never accept a database URL or connect to
// an existing server: even development contains real investor data.
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const root = await mkdtemp(join(tmpdir(), "brikvest-pg-race-"));
const data = join(root, "data");
const socket = join(root, "socket");
const database = "brikvest_disposable_concurrency";
const token = randomUUID();
// Do not pass inherited DB credentials, provider keys or SMTP secrets to tests.
const env = {
  PATH: process.env.PATH, HOME: process.env.HOME, LANG: "C.UTF-8",
  NODE_ENV: "test", TEST_DATABASE_URL: "postgresql://invalid@127.0.0.1:9/invalid",
  DATABASE_URL: "postgresql://invalid@127.0.0.1:9/invalid",
  FLW_PG_TEST_SOCKET: socket, FLW_PG_TEST_ROOT: root, FLW_PG_TEST_TOKEN: token,
};
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { env, stdio: "inherit", timeout: 180_000, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status})`);
}
let started = false;
try {
  await mkdir(socket, { mode: 0o700 });
  await writeFile(join(root, "disposable-test-marker"), token, { mode: 0o600 });
  run("initdb", ["-D", data, "-U", "race_test", "--auth=trust", "--no-locale", "--encoding=UTF8"]);
  // Unix sockets only, in a fresh private directory; no shared TCP port.
  run("pg_ctl", ["-D", data, "-l", join(root, "postgres.log"), "-o",
    `-F -c listen_addresses='' -c unix_socket_directories='${socket}' -c max_connections=12`, "-w", "start"]);
  started = true;
  run("createdb", ["-h", socket, "-U", "race_test", database]);
  run("pnpm", ["exec", "vitest", "run", "--config", "vitest.flutterwave-postgres.config.ts"]);
} finally {
  // Do not remove a running cluster if stopping it fails.
  if (started) run("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"]);
  await rm(root, { recursive: true, force: true });
}
