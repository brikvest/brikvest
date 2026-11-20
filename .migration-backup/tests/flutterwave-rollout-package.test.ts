import fs from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Disabled Flutterwave main-project handoff", () => {
  it("keeps collection, authorization, workers and payment emails explicitly off in both environments", async () => {
    const config = await fs.readFile(".replit", "utf8");
    for (const environment of ["development", "production"]) {
      const section = config.match(new RegExp(
        `\\[userenv\\.${environment}\\]\\s*\\n([\\s\\S]*?)(?=\\n\\[|$)`,
      ))?.[1];
      expect(section, `Missing ${environment} configuration`).toBeDefined();
      for (const key of ["FLW_ENABLED", "FLW_LIVE_AUTHORIZED", "FLW_WORKER_ENABLED", "FLW_NOTIFICATION_DISPATCH"]) {
        expect(section).toMatch(new RegExp(`^${key}\\s*=\\s*"false"\\s*$`, "m"));
      }
    }
  });

  it("keeps automatic post-merge mutations fenced and Flutterwave SQL out of startup/build hooks", async () => {
    const config = await fs.readFile(".replit", "utf8");
    const postMerge = await fs.readFile("scripts/post-merge.sh", "utf8");
    expect(config).toMatch(/SKIP_POST_MERGE_DATABASE_MUTATIONS\s*=\s*"true"/);
    expect(postMerge.indexOf("exit 0")).toBeLessThan(postMerge.indexOf("npx tsx"));
    expect(postMerge).not.toContain("ensure-flutterwave");
    const app = await fs.readFile("server/index.ts", "utf8");
    expect(app).not.toContain("ensure-flutterwave");
    const { scripts } = JSON.parse(await fs.readFile("package.json", "utf8"));
    expect(scripts.build).not.toMatch(/db:push|drizzle|ensure-flutterwave/);
  });

  it("includes the approved documents and distinguishes the inventory from an actual publication diff", async () => {
    for (const path of [
      "docs/flutterwave-main-handoff.md",
      "docs/flutterwave-v3-schema-rollout.md",
      "docs/pdf-approval-safeguard-review.md",
      "docs/flutterwave-payments.md",
    ]) expect((await fs.readFile(path, "utf8")).length).toBeGreaterThan(100);
    const inventory = await fs.readFile("docs/flutterwave-production-change-review.md", "utf8");
    expect(inventory).toContain("not the actual SQL diff from Publish");
    const handoff = await fs.readFile("docs/flutterwave-main-handoff.md", "utf8");
    expect(handoff).toContain("not production activation");
  });
});
