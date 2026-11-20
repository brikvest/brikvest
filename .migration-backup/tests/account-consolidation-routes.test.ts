import express from "express";
import request from "supertest";
import { describe, expect, it, vi, beforeEach } from "vitest";
const mocked = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock("../server/db", () => ({ pool: { connect: mocked.connect } }));
import { registerAccountConsolidationRoutes } from "../server/account-consolidation-routes";

function app() {
  const server = express();
  server.use(express.json());
  registerAccountConsolidationRoutes(server, (req: any, res, next) => {
    if (req.headers.authorization !== "Bearer isolated-admin") return void res.status(401).json({ message: "Admin access required" });
    req.user = { userId: 7 };
    next();
  });
  return server;
}
beforeEach(() => vi.clearAllMocks());
describe("authenticated consolidation routes", () => {
  it.each(["/api/admin/account-consolidations/preview", "/api/admin/account-consolidations"])("requires admin middleware for %s", async path => {
    expect((await request(app()).post(path).send({ sourceId: 1, destinationId: 2 })).status).toBe(401);
    expect(mocked.connect).not.toHaveBeenCalled();
  });
  it("validates IDs and explicit confirmation before opening a connection", async () => {
    const response = await request(app()).post("/api/admin/account-consolidations").set("Authorization", "Bearer isolated-admin").send({ sourceId: 1, destinationId: 2 });
    expect(response.status).toBe(400);
    expect(mocked.connect).not.toHaveBeenCalled();
  });
  it("fails safely if schema or database is unavailable", async () => {
    mocked.connect.mockRejectedValue(new Error("sensitive connection data"));
    const response = await request(app()).post("/api/admin/account-consolidations/preview").set("Authorization", "Bearer isolated-admin").send({ sourceId: 1, destinationId: 2 });
    expect(response.status).toBe(503);
    expect(response.text).not.toContain("sensitive connection data");
    expect(response.body.message).toContain("Completion was not confirmed");
  });
});
