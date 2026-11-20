import { spawnSync } from "node:child_process";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { expect, it } from "vitest";

it("loads and embeds the Unicode font in an externalized native Node ESM production bundle", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "legal-production-renderer-"));
  try {
    // Use the deployment's bundle settings, not Vitest's module interop.
    const outfile = path.join(directory, "renderer.mjs");
    await symlink(path.resolve("node_modules"), path.join(directory, "node_modules"), "dir");
    await build({
      entryPoints: ["server/legal/local-pdf-signature.ts"],
      outfile, bundle: true, platform: "node", format: "esm", packages: "external",
    });
    const program = `
      import { getLocalSigningFontSha256, renderLocalSigningEvidencePdf } from ${JSON.stringify(pathToFileURL(outfile).href)};
      const signerName = "Ọládélé Ajáyí";
      const renderFontSha256 = await getLocalSigningFontSha256(signerName);
      const pdf = await renderLocalSigningEvidencePdf({
        documentType: "deed_of_assignment", documentId: 1, pairId: 1,
        operationId: 1, reservationId: 1, propertyName: "Fixture estate",
        propertyLocation: "Fixture location", units: "1", areaSqm: "5",
        signerName, signatureMethod: "typed", renderFontSha256,
        unsignedPdfSha256: "a".repeat(64), signedPdfSha256: "b".repeat(64),
        signaturePngSha256: "c".repeat(64), consentVersion: "fixture-consent",
        consentText: "I reviewed this fixture document.",
        consentedAt: new Date("2026-10-04T12:00:00Z"),
        reauthenticatedAt: new Date("2026-10-04T12:00:00Z"),
        reviewedAt: new Date("2026-10-04T12:00:00Z"),
        signedAt: new Date("2026-10-04T12:00:00Z")
      });
      if (pdf.subarray(0, 5).toString() !== "%PDF-" || pdf.length < 1000) {
        throw new Error("Invalid production-rendered evidence PDF");
      }
      console.log("Native production font preflight and PDF rendering passed");
    `;
    // Inherit exactly the project's production font configuration. No server,
    // database, storage operations, real signatures or notification dispatch.
    const result = spawnSync("bash", [
      "scripts/legal-font-env.sh", process.execPath, "--input-type=module", "-e", program,
    ], { encoding: "utf8", timeout: 30_000, maxBuffer: 64 * 1024 });
    expect(result.status, result.stderr || result.error?.message).toBe(0);
    expect(result.stdout).toContain("Native production font preflight and PDF rendering passed");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});