import express, { type Express } from "express";
import type { Server } from "http";

let cachedApp: Express | null = null;
let cachedServer: Server | null = null;
let cachedRegisterPromise: Promise<{ app: Express; server: Server }> | null =
  null;

const originalSetInterval: typeof setInterval = global.setInterval;

/**
 * Replace `setInterval` with a no-op handle that unrefs immediately, so the
 * background cleanup timers registered by `registerRoutes` do not keep the
 * vitest process alive between test files.  We restore the real impl as soon
 * as `registerRoutes` returns so the rest of the suite is unaffected.
 */
function silenceBackgroundTimers() {
  const noop: typeof setInterval = (() => {
    const handle = originalSetInterval(() => {}, 1 << 30);
    handle.unref?.();
    return handle;
  }) as typeof setInterval;
  global.setInterval = noop;
}

function restoreBackgroundTimers() {
  global.setInterval = originalSetInterval;
}

export async function getTestApp(): Promise<{ app: Express; server: Server }> {
  if (cachedApp && cachedServer) {
    return { app: cachedApp, server: cachedServer };
  }
  if (cachedRegisterPromise) return cachedRegisterPromise;

  cachedRegisterPromise = (async () => {
    silenceBackgroundTimers();
    try {
      const app = express();
      app.use(express.json());
      app.use(express.urlencoded({ extended: false }));

      const { registerRoutes } = await import("../server/routes");
      const server = await registerRoutes(app);

      cachedApp = app;
      cachedServer = server;
      return { app, server };
    } finally {
      restoreBackgroundTimers();
    }
  })();
  return cachedRegisterPromise;
}

export async function closeTestApp() {
  if (cachedServer) {
    await new Promise<void>((resolve) =>
      cachedServer!.close(() => resolve()),
    );
  }
  cachedApp = null;
  cachedServer = null;
  cachedRegisterPromise = null;
}
