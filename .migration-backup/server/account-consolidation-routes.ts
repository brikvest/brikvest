import type { Express, RequestHandler } from "express";
import { z } from "zod";
import { pool } from "./db";
import { ConsolidationError, executeConsolidation, previewConsolidation } from "./account-consolidation";

const pair = z.object({ sourceId: z.number().int().positive(), destinationId: z.number().int().positive() });
const instruction = pair.extend({
  requestId: z.string().uuid(),
  previewToken: z.string().regex(/^[a-f0-9]{64}$/),
  identityVerified: z.literal(true),
  verificationNote: z.string().trim().min(20).max(1000),
  confirmation: z.string().max(100),
  updateContactEmail: z.boolean(),
}).strict();

export function registerAccountConsolidationRoutes(app: Express, requireAdminAuth: RequestHandler) {
  const handler = (execute: boolean): RequestHandler => async (req: any, res) => {
    const parsed = (execute ? instruction : pair.strict()).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Provide valid account IDs and all required confirmation fields." });
      return;
    }
    let client;
    try {
      client = await pool.connect();
      // Bound administrative lock waits; a busy transaction must fail closed.
      await client.query("SET lock_timeout = '3s'");
      await client.query("SET statement_timeout = '15s'");
      let result;
      if (execute) {
        result = await executeConsolidation(client, instruction.parse(parsed.data), req.user.userId);
      } else {
        await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
        try {
          result = await previewConsolidation(client, parsed.data.sourceId, parsed.data.destinationId);
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        }
      }
      res.set("Cache-Control", "no-store").json(result);
    } catch (error) {
      if (error instanceof ConsolidationError) res.status(error.status).json({ message: error.message });
      else {
        console.error("[ACCOUNT CONSOLIDATION] Operation failed", { code: (error as any)?.code });
        res.status(503).json({ message: "Consolidation is unavailable or blocked by a database safeguard. Completion was not confirmed. Retry the same request to recover its status, or ask support to verify setup." });
      }
    } finally {
      if (client) {
        // Never leave altered timeouts on a pooled connection.
        try { await client.query("RESET lock_timeout; RESET statement_timeout"); client.release(); }
        catch { client.release(true); }
      }
    }
  };
  app.post("/api/admin/account-consolidations/preview", requireAdminAuth, handler(false));
  app.post("/api/admin/account-consolidations", requireAdminAuth, handler(true));
}
