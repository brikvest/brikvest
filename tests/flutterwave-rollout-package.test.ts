import fs from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Flutterwave main-project rollout settings", () => {
  const section = async (environment: string) => {
    const config = await fs.readFile(".replit", "utf8");
    const found = config.match(new RegExp(`\\[userenv\\.${environment}\\]\\s*\\n([\\s\\S]*?)(?=\\n\\[|$)`))?.[1];
    expect(found, `Missing ${environment} configuration`).toBeDefined();
    return found!;
  };
  const expectValues = (text: string, values: Record<string, string>) => {
    for (const [key, value] of Object.entries(values))
      expect(text, key).toMatch(new RegExp(`^${key}\\s*=\\s*"${value.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}"\\s*$`, "m"));
  };
  it("keeps collection, authorization, recovery and all mail off in development", async () => {
    const development = await section("development");
    expectValues(development, {
      FLW_ENABLED: "false", FLW_LIVE_AUTHORIZED: "false", FLW_WORKER_ENABLED: "false", FLW_NOTIFICATION_DISPATCH: "false",
      LEGAL_DISPATCH_PAUSED: "true", BRIKVEST_EMAIL_DISPATCH_PAUSED: "true",
    });
    expect(development).not.toMatch(/^FLW_MODE\s*=\s*"live"/m);
  });
  it("saves live collection and recovery for production while every mail path stays held", async () => {
    // Saved settings take effect only when the owner publishes; the database
    // safeguard gate separately keeps live checkout closed until the owner
    // installs the three reviewed triggers.
    expectValues(await section("production"), {
      FLW_MODE: "live", FLW_RETURN_ORIGIN: "https://brikvest.net",
      FLW_LIVE_AUTHORIZED: "true", FLW_WORKER_ENABLED: "true", FLW_ENABLED: "true",
      FLW_NOTIFICATION_DISPATCH: "false", LEGAL_DISPATCH_PAUSED: "true", BRIKVEST_EMAIL_DISPATCH_PAUSED: "true",
    });
  });
  it("never stores provider credentials in project configuration", async () => {
    const config = await fs.readFile(".replit", "utf8");
    expect(config).not.toMatch(/FLW_SECRET_KEY|FLW_SECRET_HASH|FLWSECK/);
  });

  it("keeps automatic post-merge mutations fenced and Flutterwave SQL out of startup/build hooks", async () => {
    const config = await fs.readFile(".replit", "utf8");
    const postMerge = await fs.readFile("scripts/post-merge.sh", "utf8");
    expect(config).toMatch(/SKIP_POST_MERGE_DATABASE_MUTATIONS\s*=\s*"true"/);
    expect(postMerge).toContain("exit 0");
    // The workspace port made merge setup install-only, removing all automatic
    // rollout commands rather than relying solely on their position after a flag.
    expect(postMerge).not.toMatch(/^\s*(?:npx tsx|psql|pnpm.*(?:db:push|db push))/m);
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
