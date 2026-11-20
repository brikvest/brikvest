import { describe, expect, it } from "vitest";
import { getLegalReadiness } from "../scripts/legal-readiness";

function fontconfigResponse(args: string[]): string {
  const style = args.at(-1)?.match(/style=(.+)$/)?.[1] || "Regular";
  return `Liberation Serif|${style}|${process.execPath}`;
}

const completeEnvironment = {
  DATABASE_URL: "postgres://private.invalid",
  PRIVATE_OBJECT_DIR: "bucket/private",
  SESSION_SECRET: "never-print-session-secret",
  SMTP_USER: "mail@example.test",
  SMTP_PASS: "never-print-this-password",
  APP_BASE_URL: "https://brikvest.example.test",
};

describe("legal workflow readiness", () => {
  it.each([
    "", "http://brikvest.net", "https://brikvest.net/dashboard",
    "https://user:private@brikvest.net", "https://brikvest.net/?q=1", "https://brikvest.net/#fragment",
  ])("fails readiness for an invalid email origin without exposing its value", origin => {
    const result = getLegalReadiness({ ...completeEnvironment, APP_BASE_URL: origin }, () => "available");
    expect(result.checks.find(check => check.id === "application-base-url")).toMatchObject({ ready: false, detail: expect.stringContaining("clean HTTPS") });
    expect(JSON.stringify(result)).not.toContain("user:private");
  });

  it("reports configuration presence without emitting environment values", () => {
    const result = getLegalReadiness(completeEnvironment, (command, args) => {
      if (command === "soffice" && args[0] === "--version") {
        return "LibreOffice 24.2";
      }
      if (command === "fc-match") return fontconfigResponse(args);
      if (command === "pdftohtml" && args[0] === "-v") return "";
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
    expect(result.fonts).toHaveLength(4);
    expect(result.fonts.map((font) => font.style)).toEqual(["Regular", "Bold", "Italic", "Bold Italic"]);
    expect(result.fonts.every((font) => font.ready && font.pathReadable)).toBe(true);
    expect(result.checks.find((check) => check.id === "document-fonts"))
      .toMatchObject({ ready: true, detail: expect.stringContaining("exact Liberation Serif regular, bold, italic and bold-italic") });
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
    expect(result.fonts).toHaveLength(4);
    expect(result.fonts.every((font) => !font.ready)).toBe(true);
    expect(result.checks.find((check) => check.id === "document-fonts")?.detail)
      .toContain("Fontconfig (fc-match) is unavailable");
    expect(JSON.stringify(result)).not.toContain("safe to suppress");
  });

  it("checks exact readable Liberation Serif faces without inspecting bundled forms", () => {
    const commands: Array<[string, string[]]> = [];
    const result = getLegalReadiness(completeEnvironment, (command, args) => {
      commands.push([command, args]);
      if (command === "fc-match") return fontconfigResponse(args);
      if (command === "pdftohtml") return "";
      return "LibreOffice 24.2";
    });
    expect(result.ready).toBe(true);
    expect(commands.slice(0, 2)).toEqual([
      ["soffice", ["--version"]],
      ["fc-match", ["-f", "%{family}|%{style}|%{file}", "Liberation Serif:style=Regular"]],
    ]);
    expect(commands.filter(([command]) => command === "fc-match")).toHaveLength(4);
    expect(commands.slice(-1)).toEqual([["pdftohtml", ["-v"]]]);
    expect(result.checks.find((check) => check.id === "document-fonts")?.detail)
      .toContain("readiness does not certify any template's fonts");
  });

  it("probes the same explicitly configured converter and fontconfig executables as conversion", () => {
    const commands: string[] = [];
    const result = getLegalReadiness({
      ...completeEnvironment,
      LIBREOFFICE_PATH: "/safe/converter",
      FC_MATCH_PATH: "/safe/fontconfig",
    }, (command, args) => {
      commands.push(command);
      if (command === "/safe/converter") return "LibreOffice 24.2";
      if (command === "/safe/fontconfig") return fontconfigResponse(args);
      if (command === "pdftohtml") return "";
      throw new Error("unexpected command");
    });
    expect(result.checks.find((check) => check.id === "libreoffice")?.ready).toBe(true);
    expect(result.checks.find((check) => check.id === "document-fonts")?.ready).toBe(true);
    expect(commands.filter((command) => command === "/safe/converter")).toHaveLength(1);
    expect(commands.filter((command) => command === "/safe/fontconfig")).toHaveLength(4);
    expect(JSON.stringify(result)).not.toContain("/safe/");
  });

  it("does not report ready if any required exact fallback face is missing", () => {
    const result = getLegalReadiness(completeEnvironment, (command, args) => {
      if (command === "soffice") return "LibreOffice 24.2";
      if (command === "fc-match" && args[0] === "--version") return "fontconfig version 2.15";
      if (command === "fc-match" && args.at(-1)?.endsWith("style=Bold Italic")) {
        return `Liberation Serif|Italic|${process.execPath}`;
      }
      if (command === "fc-match") return fontconfigResponse(args);
      return "";
    });
    expect(result.ready).toBe(false);
    expect(result.checks.find((check) => check.id === "document-fonts"))
      .toMatchObject({ ready: false, detail: expect.stringContaining("regular, bold, italic and bold-italic") });
    expect(result.fonts.find((font) => font.style === "Bold Italic")?.ready).toBe(false);
    expect(result.checks.find((check) => check.id === "fractional-unit-inventory-accounting")?.ready)
      .toBe(true);
  });

  it("requires each resolved font path to be an absolute readable file", () => {
    const result = getLegalReadiness(completeEnvironment, (command, args) => {
      if (command === "soffice") return "LibreOffice 24.2";
      if (command === "fc-match" && args[0] === "--version") return "fontconfig version 2.15";
      if (command === "fc-match") {
        const style = args.at(-1)?.match(/style=(.+)$/)?.[1] || "Regular";
        return `Liberation Serif|${style}|/missing/font-${style}.ttf`;
      }
      return "";
    });
    expect(result.ready).toBe(false);
    expect(result.fonts.every((font) => font.pathReadable === false && !font.ready)).toBe(true);
  });

  it("reports missing image-placement tooling without exposing errors or configuration", () => {
    const result = getLegalReadiness(completeEnvironment, (command) => {
      if (command === "pdftohtml") throw new Error("private executable error");
      return "available";
    });
    expect(result.ready).toBe(false);
    expect(result.checks.find((check) => check.id === "pdf-image-position"))
      .toMatchObject({ ready: false, detail: expect.stringContaining("pdftohtml") });
    expect(JSON.stringify(result)).not.toContain("private executable error");
  });
});