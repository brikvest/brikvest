import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic, log } from "./vite";
import { rejectLegalTemplateSourcePaths } from "./legal/source-access";

const app = express();
// Vite's development static-file middleware must not expose the source Word
// files through workspace paths (including /@fs/). These are never public
// assets, even before they are imported into private object storage.
app.use(rejectLegalTemplateSourcePaths);
app.use(express.json({
  limit: "1mb",
}));
app.use(express.urlencoded({ extended: false }));
app.get("/api/healthz", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({
    status: "ok",
    release: "flutterwave-live-preparation-2026-11-21",
    paymentSafety: {
      collectionEnabled: process.env.FLW_ENABLED === "true",
      recoveryEnabled: process.env.FLW_WORKER_ENABLED === "true",
      paymentMailEnabled: process.env.FLW_NOTIFICATION_DISPATCH === "true",
      legalMailPaused: process.env.LEGAL_DISPATCH_PAUSED === "true",
      applicationMailPaused: process.env.BRIKVEST_EMAIL_DISPATCH_PAUSED === "true",
    },
  });
});

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      // Signing responses contain short-lived challenge tokens. Never include
      // these, signature images, identity evidence or passwords in logs.
      if (capturedJsonResponse && !/^\/api\/(?:admin\/)?(?:legal|payments)(?:\/|$)/.test(path)) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  const server = await registerRoutes(app);

  // One-shot backfill: default funnel_stage on any pre-existing reservation
  // rows that haven't been assigned one yet. Idempotent, so it's safe to run
  // on every boot.
  try {
    const { runStartupDataMaintenance } = await import("./startup-maintenance");
    await runStartupDataMaintenance(async () => {
      const { storage } = await import("./storage");
      const n = await storage.backfillReservationFunnelStages();
      if (n > 0) log(`[startup] Backfilled funnel_stage on ${n} reservation(s).`);
    });
  } catch (err) {
    console.error("[startup] funnel_stage backfill failed:", err);
  }

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // Serve static files from public directory (guzape.html, etc.)
  app.use(express.static('public'));

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  // The web artifact owns Vite in development. Production keeps the original
  // static fallback for the existing server-based run command.
  if (app.get("env") !== "development") {
    serveStatic(app);
  }

  // ALWAYS serve the app on port 5000
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = process.env.PORT ? parseInt(process.env.PORT) : 5000;
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, () => {
    log(`serving on port ${port}`);
  });
})();
