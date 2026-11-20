import { execFileSync } from "node:child_process";
import {
  fontconfigFaceReadiness,
  LIBERATION_SERIF_STYLES,
  resolveFontconfigFamily,
  type LegalFontReadiness,
} from "../server/legal/font-validation";
import { resolveLibreOfficeExecutable } from "../server/legal/converter";
import { legalApplicationOrigin } from "../server/legal/application-origin";
export type { LegalFontReadiness } from "../server/legal/font-validation";

export type LegalReadinessCheck = {
  id: string;
  ready: boolean;
  detail: string;
};

export type LegalReadiness = {
  ready: boolean;
  checks: LegalReadinessCheck[];
  missingEnvironmentVariables: string[];
  fonts: LegalFontReadiness[];
};

type ReadinessEnvironment = Record<string, string | undefined>;
type Execute = (command: string, args: string[]) => string;

const SECRET_NAMES = [
  "DATABASE_URL",
  "PRIVATE_OBJECT_DIR",
  "SESSION_SECRET",
  "SMTP_USER",
  "SMTP_PASS",
  "APP_BASE_URL",
] as const;

function execute(command: string, args: string[]): string {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 10_000,
  }).trim();
}

function getFontReadiness(
  run: Execute,
  fontconfigPath?: string,
): { fonts: LegalFontReadiness[]; available: boolean; detail: string } {
  let successfulFontQueries = 0;
  const fonts: LegalFontReadiness[] = [];
  for (const style of LIBERATION_SERIF_STYLES) {
    try {
      const output = run(
        fontconfigPath || process.env.FC_MATCH_PATH || "fc-match",
        ["-f", "%{family}|%{style}|%{file}", `Liberation Serif:style=${style}`],
      );
      successfulFontQueries += 1;
      fonts.push(fontconfigFaceReadiness("Liberation Serif", style, output));
    } catch {
      fonts.push({
        family: "Liberation Serif",
        style,
        matchedFamily: "unavailable",
        pathReadable: false,
        installedExactMatch: false,
        embeddedInTemplate: false,
        ready: false,
      });
    }
  }
  const fontconfigAvailable = successfulFontQueries > 0;
  const facesReady = fonts.length === LIBERATION_SERIF_STYLES.length && fonts.every((font) => font.ready);
  const helperAvailable = typeof resolveFontconfigFamily === "function";
  return {
    fonts,
    available: fontconfigAvailable && helperAvailable && facesReady,
    detail: !fontconfigAvailable
      ? "Fontconfig (fc-match) is unavailable; font verification and exact Liberation Serif face checks cannot run."
      : !helperAvailable
        ? "The per-template font verification helper is unavailable."
        : !facesReady
          ? "The authorized Liberation Serif fallback is not ready: exact regular, bold, italic and bold-italic faces with readable font files are required in this converter environment."
          : "The exact Liberation Serif regular, bold, italic and bold-italic faces resolve to readable files in this converter environment. Each property's actual DOCX fonts are separately checked during preview, activation and generation; readiness does not certify any template's fonts.",
  };
}

/**
 * Readiness is deliberately read-only: it only inspects whether configuration
 * is present and queries local converter/font executables. It never connects
 * to PostgreSQL, creates files, or returns secret values.
 */
export function getLegalReadiness(
  env: ReadinessEnvironment = process.env,
  run: Execute = execute,
): LegalReadiness {
  const missingEnvironmentVariables: string[] = SECRET_NAMES.filter(
    (name) => !env[name]?.trim(),
  );
  let originReady = false;
  try { legalApplicationOrigin(env.APP_BASE_URL); originReady = true; } catch { /* Names and safe guidance only. */ }
  let libreOfficeVersion = "";
  try {
    libreOfficeVersion = run(
      resolveLibreOfficeExecutable(env.LIBREOFFICE_PATH, env.SOFFICE_PATH),
      ["--version"],
    );
  } catch {
    // The readiness result reports a simple unavailable state, never an
    // exception message that could include unrelated process configuration.
  }

  const fontReadiness = getFontReadiness(run, env.FC_MATCH_PATH);
  let pdfImagePositionAvailable = false;
  try {
    // Poppler writes its version to stderr; successful execution is sufficient.
    run(env.PDFTOHTML_PATH || "pdftohtml", ["-v"]);
    pdfImagePositionAvailable = true;
  } catch {
    // Fail closed during signing if image bounds cannot be verified.
  }

  const checks: LegalReadinessCheck[] = [
    {
      id: "database-configuration",
      ready: Boolean(env.DATABASE_URL?.trim()),
      detail: env.DATABASE_URL?.trim()
        ? "Database connection is configured; no connection was attempted."
        : "DATABASE_URL is not configured.",
    },
    {
      id: "fractional-unit-inventory-accounting",
      ready: true,
      detail:
        "Supported scope: only whole-unit holdings can be allocated, with each unit representing 5 m². Fractional-unit approvals fail closed because inventory counters store whole units; fractional inventory accounting is outside this workflow.",
    },
    {
      id: "private-object-storage",
      ready: Boolean(env.PRIVATE_OBJECT_DIR?.trim()),
      detail: env.PRIVATE_OBJECT_DIR?.trim()
        ? "Private object storage is configured; no object was read or written."
        : "PRIVATE_OBJECT_DIR is not configured.",
    },
    {
      id: "session-authentication",
      ready: Boolean(env.SESSION_SECRET?.trim()),
      detail: env.SESSION_SECRET?.trim()
        ? "The built-in authenticated-session secret is configured."
        : "SESSION_SECRET is not configured.",
    },
    {
      id: "email",
      ready: Boolean(env.SMTP_USER?.trim() && env.SMTP_PASS?.trim()),
      detail:
        env.SMTP_USER?.trim() && env.SMTP_PASS?.trim()
          ? "SMTP credentials are configured; no email was sent."
          : "SMTP_USER and SMTP_PASS are both required.",
    },
    {
      id: "legal-job-scheduler-authentication",
      ready: true,
      detail: env.LEGAL_DISPATCH_SECRET?.trim()
        ? "Optional scheduler bearer authentication is configured; admin-authenticated dispatch is also available."
        : "Optional LEGAL_DISPATCH_SECRET is not configured; the scheduler bearer route is unavailable, but admin-authenticated dispatch remains available.",
    },
    {
      id: "application-base-url",
      ready: originReady,
      detail: originReady
        ? "Application origin is configured for email deep links; local signing does not use a provider callback."
        : "APP_BASE_URL must be configured as a clean HTTPS application origin without credentials, path, query or fragment.",
    },
    {
      id: "libreoffice",
      ready: Boolean(libreOfficeVersion),
      detail: libreOfficeVersion
        ? `Converter available: ${libreOfficeVersion}`
        : "LibreOffice executable is unavailable.",
    },
    {
      id: "document-fonts",
      ready: fontReadiness.available,
      detail: fontReadiness.detail,
    },
    {
      id: "pdf-image-position",
      ready: pdfImagePositionAvailable,
      detail: pdfImagePositionAvailable
        ? "Poppler image-position extraction is available to keep investor signatures clear of existing images."
        : "Poppler pdftohtml is unavailable; investor signing cannot verify a clear area around existing images.",
    },
  ];

  return {
    ready: checks.every((check) => check.ready),
    checks,
    missingEnvironmentVariables,
    fonts: fontReadiness.fonts,
  };
}

function main(): void {
  const readiness = getLegalReadiness();
  // Only identifiers, booleans, and explicitly safe operational detail are
  // emitted. Never output environment values, credentials, or connection URLs.
  console.log(JSON.stringify(readiness, null, 2));
  if (!readiness.ready) process.exitCode = 1;
}

if (process.argv[1]?.endsWith("legal-readiness.ts")) main();