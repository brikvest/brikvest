import { describe, expect, it } from "vitest";
import { getLegalReadiness } from "../scripts/legal-readiness";

const completeEnvironment = {
  DATABASE_URL: "postgres://private.invalid",
  PRIVATE_OBJECT_DIR: "bucket/private",
  SESSION_SECRET: "never-print-session-secret",
  SMTP_USER: "mail@example.test",
  SMTP_PASS: "never-print-this-password",
  APP_BASE_URL: "https://brikvest.example.test",
};

describe("legal workflow readiness", () => {
  it("reports configuration presence without emitting environment values", () => {
    const result = getLegalReadiness(completeEnvironment, (command, args) => {
      if (command === "libreoffice" && args[0] === "--version") {
        return "LibreOffice 24.2";
      }
      if (command === "fc-match") return args[2];
      throw new Error("unexpected local command");
    });

    expect(result.ready).toBe(false);
    expect(result.missingEnvironmentVariables).toEqual([]);
    expect(result.checks.find((check) => check.id === "fractional-unit-inventory-accounting"))
      .toMatchObject({
        ready: false,
        detail: expect.stringContaining("Fractional-unit approvals fail closed"),
      });
    expect(JSON.stringify(result)).not.toContain("never-print");
    expect(JSON.stringify(result)).not.toContain("postgres://");
    expect(result.checks.find((check) => check.id === "database-configuration")?.detail)
      .toContain("no connection was attempted");
    expect(result.checks.find((check) => check.id === "session-authentication")?.ready)
      .toBe(true);
    expect(result.checks.find((check) => check.id === "legal-job-scheduler-authentication"))
      .toMatchObject({ ready: true, detail: expect.stringContaining("Optional LEGAL_DISPATCH_SECRET") });
    expect(result.checks.find((check) => check.id === "application-base-url")?.detail)
      .toContain("email deep links");
    expect(result.missingEnvironmentVariables).not.toContain("LEGAL_DISPATCH_SECRET");
    expect(result.missingEnvironmentVariables.some((name) => name.startsWith("DOCUSIGN_")))
      .toBe(false);
    expect(result.fonts.map((font) => font.family)).toEqual([
      "Cambria",
      "Georgia",
      "Palatino Linotype",
    ]);
    expect(result.fonts.find((font) => font.family === "Palatino Linotype")?.embeddedInTemplate)
      .toBe(true);
    expect(result.fonts.find((font) => font.family === "Cambria")?.embeddedInTemplate)
      .toBe(false);
    expect(result.fonts.find((font) => font.family === "Georgia")?.embeddedInTemplate)
      .toBe(false);
  });

  it("reports missing configuration by name only and treats unavailable tools as not ready", () => {
    const result = getLegalReadiness({}, () => {
      throw new Error("safe to suppress");
    });

    expect(result.ready).toBe(false);
    expect(result.missingEnvironmentVariables).toContain("SESSION_SECRET");
    expect(result.missingEnvironmentVariables).toContain("PRIVATE_OBJECT_DIR");
    expect(result.missingEnvironmentVariables).not.toContain("LEGAL_DISPATCH_SECRET");
    expect(result.missingEnvironmentVariables.some((name) => name.startsWith("DOCUSIGN_")))
      .toBe(false);
    expect(result.checks.find((check) => check.id === "libreoffice")?.ready).toBe(false);
    expect(result.checks.find((check) => check.id === "document-fonts")?.ready).toBe(false);
    expect(result.fonts.find((font) => font.family === "Palatino Linotype")?.embeddedInTemplate)
      .toBe(true);
    expect(result.fonts.find((font) => font.family === "Cambria")?.embeddedInTemplate)
      .toBe(false);
    expect(result.fonts.find((font) => font.family === "Georgia")?.embeddedInTemplate)
      .toBe(false);
    expect(JSON.stringify(result)).not.toContain("safe to suppress");
  });
});