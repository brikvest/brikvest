import fs from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { rejectLegalTemplateSourcePaths } from "../scripts/brikvest-source-access";

async function compareTree(from: string, to: string, exceptions = new Set<string>(), prefix = "") {
  let count = 0;
  for (const entry of await fs.readdir(from, { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    if (exceptions.has(relative)) continue;
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) count += await compareTree(source, target, exceptions, relative);
    else if (entry.isFile()) {
      const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
      expect(digest(await fs.readFile(target)), relative).toEqual(digest(await fs.readFile(source)));
      count++;
    }
  }
  return count;
}

describe("Brikvest structural port", () => {
  it("rejects private legal sources on Connect requests without Express-only fields", () => {
    for (const url of [
      "/server/legal/template-assets/private.docx",
      "/@fs/home/runner/workspace/artifacts/api-server/src/legal/template-assets/private.docx",
      "/%2573erver/legal/template-assets/private.docx",
      "/Deed_of_Assignment_Brikvest_123.docx",
    ]) {
      let ended = false, continued = false;
      const response = { statusCode: 200, end() { ended = true; } };
      rejectLegalTemplateSourcePaths({ url } as any, response as any, () => { continued = true; });
      expect(response.statusCode).toBe(404);
      expect(ended).toBe(true);
      expect(continued).toBe(false);
    }
  });
  it("preserves all untouched frontend code and the original theme, assets and HTML", async () => {
    expect(await compareTree(".migration-backup/client/src", "artifacts/brikvest/src", new Set([
      "App.tsx", "components/legal/AdminLegalWorkspace.tsx", "components/legal/legalActionErrors.tsx",
    ]))).toBeGreaterThan(100);
    await compareTree(".migration-backup/client/public", "artifacts/brikvest/public");
    await compareTree(".migration-backup/attached_assets", "attached_assets");
    expect(await fs.readFile("artifacts/brikvest/index.html")).toEqual(await fs.readFile(".migration-backup/client/index.html"));
  });

  it("preserves backend business rules, original schema sources and prepared review documents", async () => {
    expect(await compareTree(".migration-backup/server", "artifacts/api-server/src", new Set(["index.ts", "vite.ts"]))).toBeGreaterThan(50);
    await compareTree(".migration-backup/shared", "shared");
    await compareTree(".migration-backup/shared", "lib/db/src/schema");
    await compareTree(".migration-backup/docs", "docs");
    await compareTree(".migration-backup/scripts", "scripts", new Set(["post-merge.sh"]));
    await compareTree(".migration-backup/tests", "tests", new Set(["flutterwave-rollout-package.test.ts"]));
  });

  it("resolves the entire real production backend without executing any application code", async () => {
    const result = await build({
      entryPoints: ["artifacts/api-server/src/index.ts"],
      outfile: "generated-artifacts/port-backend.mjs",
      bundle: true, platform: "node", packages: "external", format: "esm",
      alias: { "@shared": path.resolve("shared") },
      write: false, metafile: true, logLevel: "silent",
    });
    expect(Object.keys(result.metafile!.inputs).some(file => file.endsWith("flutterwave.ts"))).toBe(true);
    expect(Object.keys(result.metafile!.inputs).some(file => file.endsWith("brikvest-fixture-api.mjs"))).toBe(false);
  });

  it("keeps development review isolated and production startup real, with no DDL in either build or merge setup", async () => {
    const fixture = await fs.readFile("scripts/brikvest-fixture-api.mjs", "utf8");
    expect(fixture).not.toMatch(/from ["'](?:.*server|.*db|.*email|.*payments)/);
    const api = JSON.parse(await fs.readFile("artifacts/api-server/package.json", "utf8"));
    expect(api.scripts.dev).toBe("node ../../scripts/brikvest-fixture-api.mjs");
    expect(api.scripts.start).toContain("legal-font-env.sh node artifacts/api-server/dist/index.mjs");
    const merge = await fs.readFile("scripts/post-merge.sh", "utf8");
    expect(merge).toContain("SKIP_POST_MERGE_DATABASE_MUTATIONS");
    expect(merge).not.toMatch(/^\s*(?:psql|npx|pnpm.*(?:push|start|run dev))/m);
    expect(await fs.readFile("artifacts/api-server/build.mjs", "utf8")).not.toMatch(/drizzle-kit|ensure-.*sql|import\(.+index/);
  });
});
