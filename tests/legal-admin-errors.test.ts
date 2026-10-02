import { afterEach, describe, expect, it, vi } from "vitest";
import { adminLegalFailure } from "../server/legal/admin-errors";

afterEach(() => vi.restoreAllMocks());
describe("safe template service diagnostics", () => {
  it.each([
    ["fonts", 503, "FONT_SERVICE_UNAVAILABLE"],
    ["font-metadata", 422, "FONT_METADATA_REJECTED"],
    ["service", 503, "PDF_CONVERSION_UNAVAILABLE"],
  ] as const)("classifies conversion %s without disclosing process output", (kind, status, code) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = adminLegalFailure(Object.assign(new Error("raw /tmp/font secret document"), {
      name: "LegalPdfConversionError", kind,
      cause: Object.assign(new Error("sensitive"), { code: "ENOENT" }),
    }), "conversion");
    expect(result.status).toBe(status);
    expect(result.failure.code).toBe(code);
    expect(JSON.stringify(result)).not.toMatch(/\/tmp|secret|sensitive/);
    expect(result.failure.nextAction).toMatch(/administrator/);
    if (kind === "font-metadata") expect(result.failure.issues).toHaveLength(1);
    else expect(result.failure.supportReference).toMatch(/^LEGAL-/);
  });

  it("logs bounded diagnostic cause codes without exception text or document clauses", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = adminLegalFailure(Object.assign(new Error("SQL containing investor clauses"), {
      cause: Object.assign(new Error("credentials postgres://private"), { code: "42846" }),
    }), "save");
    const diagnostics = log.mock.calls[0][1];
    expect(diagnostics).toMatchObject({ reference: result.failure.supportReference, causes: [{ type: "Error", code: "42846" }] });
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/clauses|credentials|postgres:|SQL/);
  });
});