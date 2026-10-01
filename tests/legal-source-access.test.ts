import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { rejectLegalTemplateSourcePaths } from "../server/legal/source-access";

const app = express();
app.use(rejectLegalTemplateSourcePaths);
app.use((_req, res) => res.status(200).send("static"));

describe("legal template source privacy", () => {
  it.each([
    "/server/legal/template-assets/deed_of_assignment_v1.docx",
    "/@fs/home/runner/workspace/server/legal/template-assets/transfer_exit_rights_v1.docx",
    "/attached_assets/DEED_OF_ASSIGNMENT_BRIKVEST_1790828516010.docx",
    "/@fs/home/runner/workspace/attached_assets/TRANSFER_AND_EXIT_RIGHT_AGREEMENT_1790828516011.docx",
    "/server%252flegal%252ftemplate-assets%252fdeed_of_assignment_v1.docx",
  ])("denies unauthenticated workspace source access: %s", async (path) => {
    expect((await request(app).get(path)).status).toBe(404);
  });
  it("does not intercept authorized record-based routes or ordinary public assets", async () => {
    expect((await request(app).get("/api/admin/legal/templates/1/download")).status).toBe(200);
    expect((await request(app).get("/assets/logo.png")).status).toBe(200);
  });
});