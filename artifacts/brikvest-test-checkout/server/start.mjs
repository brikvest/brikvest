import { pathToFileURL, fileURLToPath } from "node:url";
import { buildLifecycle } from "./build-lifecycle.mjs";
import { assertRuntimeFence, BASE } from "./config.mjs";
import { createSandboxApp } from "./app.mjs";

assertRuntimeFence();
if (process.env.BASE_PATH?.replace(/\/$/, "") !== BASE)
  throw new Error("Sandbox base path mismatch. Refusing to serve on a real application route.");
const port = Number(process.env.PORT);
if (!Number.isInteger(port) || port < 1) throw new Error("Managed workflow PORT is required.");
const runtime = await import(pathToFileURL(await buildLifecycle()).href);
const app = await createSandboxApp(runtime);
const { createServer } = await import("vite");
const vite = await createServer({
  configFile: fileURLToPath(new URL("../vite.config.ts", import.meta.url)),
  server: { middlewareMode: true, fs: { strict: true, allow: [fileURLToPath(new URL("../", import.meta.url))] } },
});
app.use(vite.middlewares);
const server = app.listen(port, "0.0.0.0");
async function stop() {
  server.close();
  await vite.close();
  await runtime.database.close();
  process.exit(0);
}
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => void stop());
