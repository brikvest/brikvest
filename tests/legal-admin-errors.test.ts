import { afterEach, describe, expect, it, vi } from "vitest";
import { adminLegalFailure } from "../server/legal/admin-errors";

afterEach(() => vi.restoreAllMocks());
describe("safe template service diagnostics", () => {
  it("distinguishes interfering blocks from valid separate required sections", () => {
    const result = adminLegalFailure(Object.assign(new Error("private layout"), {
      name: "SignaturePositionValidationError", kind: "layout",
    }), "placement");
    expect(result.status).toBe(422);
    const instruction = result.failure.issues[0].instruction;
    expect(instruction).toContain("may remain before or after");
    expect(instruction).toContain("complete");
    expect(instruction).toContain("at the same height");
    expect(instruction).toContain("required legal wording must remain");
    expect(result.failure.nextAction).toContain("preview and activate separately");
    expect(JSON.stringify(result)).not.toContain("private layout");
  });
  it.each([
    ["fonts", 503, "FONT_FALLBACK_UNAVAILABLE"],
    ["recovery-fonts", 503, "RECOVERY_FONT_UNAVAILABLE"],
    ["font-service", 503, "FONT_SERVICE_UNAVAILABLE"],
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
    if (kind === "fonts") {
      expect(result.failure.nextAction).toMatch(/Liberation Serif 12 pt/);
      expect(result.failure.nextAction).toMatch(/pagination/);
      expect(result.failure.nextAction).toMatch(/signature placement/);
    }
    if (kind === "font-service") expect(result.failure.nextAction).toMatch(/verification infrastructure/);
    if (kind === "recovery-fonts") {
      expect(result.failure.nextAction).toMatch(/exact original font files/);
      expect(result.failure.nextAction).toMatch(/Do not reformat the immutable Word document/);
      expect(result.failure.nextAction).not.toMatch(/fallback preserves/i);
    }
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