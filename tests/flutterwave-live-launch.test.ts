import fs from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { REQUIRED_SAFEGUARDS, requireLiveSafeguards, safeguardStatus } from "../server/payments/gateway-guards";
import { RELEASE_ID } from "../server/release";

const sqlBlocks = (document: string) => [...document.matchAll(/```sql\n([\s\S]*?)```/g)].map(match => match[1]);
const read = (file: string) => fs.readFile(file, "utf8");
const states = async (db: any) => Object.fromEntries((await safeguardStatus(db)).map(s => [s.name, s.state]));

describe("owner SQL run sheet", () => {
  it("reproduces both reviewed transactions and the acceptance query byte-for-byte, in execution order", async () => {
    const sheet = sqlBlocks(await read("docs/flutterwave-owner-run-sheet.md"));
    const guards = sqlBlocks(await read("docs/flutterwave-production-guards-console.md"));
    const pdf = sqlBlocks(await read("docs/pdf-approval-safeguard-review.md"));
    expect(guards).toHaveLength(2);
    expect(pdf).toHaveLength(1);
    expect(sheet).toHaveLength(3);
    expect(sheet[0]).toBe(guards[0]);
    expect(sheet[1]).toBe(pdf[0]);
    expect(sheet[2]).toBe(guards[1]);
    expect(sheet[0]).toContain("CREATE TRIGGER holding_cost_basis_guard");
    expect(sheet[1]).toContain("CREATE TRIGGER legal_pdf_review_append_only");
    expect(sheet[2].trim().startsWith("SELECT")).toBe(true);
  });
  it("lists the same expected hashes the application requires", async () => {
    const sheet = await read("docs/flutterwave-owner-run-sheet.md");
    for (const s of REQUIRED_SAFEGUARDS) {
      expect(sheet).toContain(`| \`${s.table}\` | \`${s.trigger}\` | ${s.tgtype} | \`${s.fn}\` | \`${s.bodyHash}\` |`);
    }
  });
});

describe("database safeguard catalog check (disposable PGlite)", () => {
  let pg: PGlite;
  let db: any;
  let block1: string, block2: string, acceptance: string;
  beforeAll(async () => {
    [block1, block2, acceptance] = sqlBlocks(await read("docs/flutterwave-owner-run-sheet.md"));
    pg = new PGlite();
    db = drizzle(pg);
    // Synthetic prerequisites equivalent to what Publish carries: tables and
    // the existing PDF-review function, but none of the three triggers.
    await pg.exec(`
      CREATE TABLE users(id integer PRIMARY KEY);
      CREATE TABLE admin_users(id integer PRIMARY KEY);
      CREATE TABLE investment_reservations(id integer PRIMARY KEY,property_id integer,
        units numeric,amount numeric,currency text,status text,cost_basis jsonb);
      CREATE TABLE legal_document_pairs(id integer PRIMARY KEY,documents_ready_at timestamptz,
        deed_template_id integer,transfer_template_id integer);
      CREATE TABLE legal_documents(id integer PRIMARY KEY,pair_id integer,document_type text,
        template_id integer,unsigned_pdf_sha256 text,unsigned_pdf_key text,
        signature_placement jsonb,superseded_at timestamptz);`);
    await pg.exec((await read("scripts/ensure-flutterwave.sql")).split("CREATE OR REPLACE FUNCTION")[0] + "COMMIT;");
    await pg.exec(await read("scripts/ensure-legal-pdf-review.sql"));
    await pg.exec("DROP TRIGGER legal_pdf_review_append_only ON legal_pdf_review_approvals");
  });
  afterAll(async () => { await pg.close(); });

  it("reports all three absent before the owner runs the sheet and fails closed", async () => {
    expect(await states(db)).toEqual({
      flutterwave_expected_immutable: "absent", holding_cost_basis_guard: "absent", legal_pdf_review_append_only: "absent",
    });
    await expect(requireLiveSafeguards(db, "investor")).rejects.toThrow("Bank transfer remains available");
  });
  it("stays closed after only the first block", async () => {
    // Only PGlite's fixed database name differs from the production identity assertion.
    await pg.exec(block1.replace("current_database() <> 'neondb'", "current_database() <> 'postgres'"));
    expect(await states(db)).toEqual({
      flutterwave_expected_immutable: "present", holding_cost_basis_guard: "present", legal_pdf_review_append_only: "absent",
    });
    await expect(requireLiveSafeguards(db, "admin")).rejects.toThrow("database safeguards");
  });
  it("opens only when the run sheet's acceptance result is exactly the reviewed three rows", async () => {
    await pg.exec(block2);
    const rows = (await pg.query<any>(acceptance)).rows;
    expect(rows.map(r => [r.table_name, r.tgname, r.tgenabled, r.tgtype, r.tgnargs, r.column_filter, r.unconditional, r.proname, r.prosecdef, r.function_body_hash])).toEqual(
      [...REQUIRED_SAFEGUARDS].sort((a, b) => a.trigger.localeCompare(b.trigger))
        .map(s => [s.table, s.trigger, "O", s.tgtype, 0, "", true, s.fn, false, s.bodyHash]));
    expect(Object.values(await states(db))).toEqual(["present", "present", "present"]);
    await expect(requireLiveSafeguards(db, "investor")).resolves.toBeUndefined();
  });
  it("treats a disabled trigger as a mismatch", async () => {
    await pg.exec("ALTER TABLE flutterwave_attempts DISABLE TRIGGER flutterwave_expected_immutable");
    expect((await states(db)).flutterwave_expected_immutable).toBe("mismatch");
    await expect(requireLiveSafeguards(db, "investor")).rejects.toThrow("temporarily unavailable");
    await pg.exec("ALTER TABLE flutterwave_attempts ENABLE TRIGGER flutterwave_expected_immutable");
    expect((await states(db)).flutterwave_expected_immutable).toBe("present");
  });
  it("treats a changed function body as a mismatch and exposes no schema detail to investors", async () => {
    await pg.exec(`CREATE OR REPLACE FUNCTION public.guard_holding_cost_basis() RETURNS trigger AS $$
      BEGIN RETURN NEW; END; $$ LANGUAGE plpgsql`);
    expect(await states(db)).toEqual({
      flutterwave_expected_immutable: "present", holding_cost_basis_guard: "mismatch", legal_pdf_review_append_only: "present",
    });
    const error = await requireLiveSafeguards(db, "investor").catch(e => e);
    expect(error.httpStatus).toBe(503);
    expect(error.message).not.toMatch(/trigger|function|hash|schema|safeguard|guard|database/i);
  });
  it("treats a trigger narrowed to fewer events as a mismatch", async () => {
    await pg.exec(`DROP TRIGGER legal_pdf_review_append_only ON legal_pdf_review_approvals;
      CREATE TRIGGER legal_pdf_review_append_only BEFORE UPDATE ON legal_pdf_review_approvals
        FOR EACH ROW EXECUTE FUNCTION legal_guard_pdf_review()`);
    expect((await states(db)).legal_pdf_review_append_only).toBe("mismatch");
  });
  it("fails closed when the catalog cannot be read", async () => {
    await expect(requireLiveSafeguards({ execute: async () => { throw new Error("offline"); } }, "investor"))
      .rejects.toThrow("temporarily unavailable");
  });
});

describe("release identity and secret-free logging", () => {
  it("reports this preparation's release from the health endpoint and nowhere hardcodes the previous one", async () => {
    expect(RELEASE_ID).toBe("flutterwave-live-launch-2026-11-26");
    const app = await read("server/index.ts");
    expect(app).toContain("release: RELEASE_ID");
    expect(app).not.toContain("flutterwave-live-preparation-2026-11-21");
  });
  it("keeps payment and legal response bodies out of request logs", async () => {
    const app = await read("server/index.ts");
    expect(app).toContain(String.raw`!/^\/api\/(?:admin\/)?(?:legal|payments)(?:\/|$)/.test(path)`);
  });
  it("logs only fixed text or counts from payment modules, never request, provider or credential data", async () => {
    for (const file of ["flutterwave-routes.ts", "flutterwave-worker.ts", "flutterwave.ts", "flutterwave-provider.ts",
      "flutterwave-checkout-closure.ts", "flutterwave-notifications.ts", "gateway-guards.ts"]) {
      const source = await read(path.join("server/payments", file));
      for (const call of source.match(/console\.\w+\([^\n]*\)/g) || []) {
        expect(call, file).toMatch(/^console\.(?:info|warn|error)\(["`]\[PAYMENTS\] /);
        expect(call, file).not.toMatch(/req\.|process\.env|payload|error\b(?!\()|\.key|hash\b|tx_ref|checkout_url/i);
      }
    }
  });
});

describe("frontend carries no payment secrets or switches", () => {
  // Server-only names and key prefixes. Hosted v3 Standard needs no browser key.
  const forbidden = /FLWSECK|FLWPUBK|FLW_SECRET|FLW_ENABLED|FLW_LIVE_AUTHORIZED|FLW_WORKER_ENABLED|FLW_NOTIFICATION_DISPATCH|FLW_MODE|VITE_FLW|BRIKVEST_TEST_FLW/;
  async function scan(root: string, extensions: RegExp) {
    const offenders: string[] = [];
    let files = 0;
    for (const entry of await fs.readdir(root, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !extensions.test(entry.name)) continue;
      const file = path.join(entry.parentPath, entry.name);
      if (file.includes("node_modules")) continue;
      files++;
      if (forbidden.test(await read(file))) offenders.push(file);
    }
    return { files, offenders };
  }
  it("source and build configuration never reference them", async () => {
    const source = await scan("artifacts/brikvest/src", /\.(?:tsx?|jsx?|css|json|html)$/);
    expect(source.files).toBeGreaterThan(50);
    expect(source.offenders).toEqual([]);
    for (const file of ["artifacts/brikvest/vite.config.ts", "artifacts/brikvest/index.html"]) {
      const text = await read(file);
      expect(text, file).not.toMatch(forbidden);
      expect(text, file).not.toMatch(/envPrefix/);
    }
  });
  it("the built web bundle never contains them", async () => {
    // Publishing builds with the same command; scripts/check-frontend-payment-secrets.mjs
    // repeats this scan as part of that build so a publish cannot skip it.
    const built = await scan("artifacts/brikvest/dist/public", /\.(?:js|mjs|css|html|json|map|txt)$/).catch(() => null);
    expect(built, "Build the web artifact first: pnpm --filter @workspace/brikvest run build").not.toBeNull();
    expect(built!.files).toBeGreaterThan(0);
    expect(built!.offenders).toEqual([]);
  });
});
