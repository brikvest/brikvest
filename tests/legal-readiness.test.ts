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
      if (command === "fc-match" && args.join(" ") === "--version") return "fontconfig version 2.15";
      throw new Error("unexpected local command");
    });

    expect(result.ready).toBe(true);
    expect(result.missingEnvironmentVariables).toEqual([]);
    expect(result.checks.find((check) => check.id === "fractional-unit-inventory-accounting"))
      .toMatchObject({
        ready: true,
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
    expect(result.fonts).toEqual([]);
    expect(result.checks.find((check) => check.id === "document-fonts"))
      .toMatchObject({ ready: true, detail: expect.stringContaining("Each property's actual DOCX fonts") });
    expect(JSON.stringify(result)).not.toMatch(/Cambria|Georgia|Palatino|pinned DOCX/);
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
    expect(result.fonts).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("safe to suppress");
  });

  it("checks fontconfig infrastructure only, never a bundled form's font family", () => {
    const commands: Array<[string, string[]]> = [];
    const result = getLegalReadiness(completeEnvironment, (command, args) => {
      commands.push([command, args]);
      return command === "fc-match" ? "fontconfig version 2.15" : "LibreOffice 24.2";
    });
    expect(result.ready).toBe(true);
    expect(commands).toEqual([
      ["libreoffice", ["--version"]],
      ["fc-match", ["--version"]],
    ]);
    expect(result.checks.find((check) => check.id === "document-fonts")?.detail)
      .toContain("readiness does not certify any template's fonts");
  });

  it("does not report ready if the fontconfig presence check returns no version", () => {
    const result = getLegalReadiness(completeEnvironment, (command) =>
      command === "libreoffice" ? "LibreOffice 24.2" : "");
    expect(result.ready).toBe(false);
    expect(result.checks.find((check) => check.id === "document-fonts"))
      .toMatchObject({ ready: false, detail: expect.stringContaining("fc-match") });
    expect(result.checks.find((check) => check.id === "fractional-unit-inventory-accounting")?.ready)
      .toBe(true);
  });
});