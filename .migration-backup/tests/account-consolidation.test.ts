import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executeConsolidation, previewConsolidation, type ConsolidationInput } from "../server/account-consolidation";

let db: PGlite;
const query = (sql: string, values?: any[]) => db.query<any>(sql, values);
beforeEach(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE TABLE admin_users(id integer primary key);
    INSERT INTO admin_users VALUES(1);
    CREATE TABLE users(id integer primary key,email text unique,first_name text,last_name text,
      role text default 'user',parent_developer_id integer references users(id),account_status text default 'approved',
      is_active boolean default true,email_verified boolean default true,kyc_status text default 'approved',
      kyc_full_name text default 'Disposable Investor',kyc_date_of_birth date default '1980-01-01',
      kyc_id_type text default 'passport',kyc_id_number text default 'TEST-IDENTITY',
      kyc_address text default 'Destination approved address',reset_token text,reset_token_expiry timestamp);
    INSERT INTO users(id,email) VALUES(1,'source@example.test'),(2,'destination@example.test');
    CREATE TABLE investment_reservations(id integer primary key,user_id integer references users(id),
      property_id integer,full_name text,email text,units numeric,amount numeric,currency text,
      unit_price_snapshot numeric,land_amount numeric,payment_reference text,status text);
    INSERT INTO investment_reservations VALUES(10,1,9,'Original Owner','old-contact@example.test',
      3.2,1008000,'NGN',315000,888000,'HISTORICAL-PAYMENT','converted_to_investment');
    INSERT INTO investment_reservations VALUES(11,2,9,'Destination Owner','destination@example.test',
      1,315000,'NGN',315000,277500,'OTHER-PAYMENT','converted_to_investment');
    CREATE TABLE ownership_certificates(id integer primary key,reservation_id integer references investment_reservations(id),
      certificate_number text,owner_name text,verification_token text);
    INSERT INTO ownership_certificates VALUES(20,10,'CERT-TEST','Original Owner','immutable-token');
    CREATE TABLE investment_payments(id integer primary key,reservation_id integer references investment_reservations(id),amount numeric);
    INSERT INTO investment_payments VALUES(30,10,1008000);
    CREATE TABLE payment_submissions(id integer primary key,reservation_id integer references investment_reservations(id),
      user_id integer references users(id),status text);
    INSERT INTO payment_submissions VALUES(40,10,1,'approved');
    CREATE TABLE legal_document_pairs(id integer primary key,user_id integer,reservation_id integer);
    CREATE TABLE local_legal_signing_operations(id integer primary key,user_id integer);
    CREATE TABLE resale_listings(id integer primary key,seller_id integer references users(id),reservation_id integer,status text);
  `);
  await db.exec(readFileSync("scripts/ensure-account-consolidations.sql", "utf8"));
});
afterEach(async () => { await db.close(); });
async function input(): Promise<ConsolidationInput> {
  const preview = await previewConsolidation({ query }, 1, 2);
  return { sourceId: 1, destinationId: 2, previewToken: preview.previewToken, requestId: randomUUID(),
    identityVerified: true, verificationNote: "Reviewed approved identity records TEST-ONLY",
    confirmation: "CONSOLIDATE 1 INTO 2", updateContactEmail: true };
}
describe("account consolidation — disposable database only", () => {
  it("moves existing IDs only, preserving KYC, valuation basis, payments, certificates and prior contacts", async () => {
    const before = (await query("SELECT * FROM investment_reservations WHERE id=10")).rows[0];
    const kyc = (await query("SELECT * FROM users WHERE id=2")).rows[0];
    const result = await executeConsolidation({ query }, await input(), 1);
    const after = (await query("SELECT * FROM investment_reservations WHERE id=10")).rows[0];
    expect(after).toEqual({ ...before, user_id: 2, email: "destination@example.test" });
    expect((await query("SELECT * FROM users WHERE id=2")).rows[0]).toEqual(kyc);
    expect((await query("SELECT is_active,email FROM users WHERE id=1")).rows[0]).toEqual({ is_active: false, email: "source@example.test" });
    expect((await query("SELECT * FROM investment_payments")).rows).toEqual([{ id: 30, reservation_id: 10, amount: "1008000" }]);
    expect((await query("SELECT owner_name,verification_token FROM ownership_certificates")).rows[0]).toEqual({ owner_name: "Original Owner", verification_token: "immutable-token" });
    expect((await query("SELECT evidence,admin_id FROM account_consolidations")).rows[0]).toMatchObject({
      admin_id: 1, evidence: { holdingsBefore: [before], holdingIds: [10] },
    });
    expect(result.holdingIds).toEqual([10]);
    expect((await query("SELECT * FROM resale_listings")).rows).toEqual([]);
    expect((await query("SELECT * FROM investment_reservations")).rows).toHaveLength(2);
  });
  it("is idempotent and rejects reuse with different instructions", async () => {
    const instructions = await input();
    const first = await executeConsolidation({ query }, instructions, 1);
    expect(await executeConsolidation({ query }, instructions, 1)).toEqual(first);
    await expect(executeConsolidation({ query }, { ...instructions, updateContactEmail: false }, 1)).rejects.toThrow("different instructions");
    expect((await query("SELECT * FROM account_consolidations")).rows).toHaveLength(1);
  });
  it.each(["kyc_id_number", "kyc_id_type", "kyc_date_of_birth", "kyc_full_name"])("rejects conflicting %s even with a shared first name", async field => {
    const instructions = await input();
    await query("UPDATE users SET first_name='Shared'");
    await query(`UPDATE users SET ${field}=$1 WHERE id=1`, [field === "kyc_date_of_birth" ? "1990-01-01" : "Unrelated"]);
    await expect(executeConsolidation({ query }, instructions, 1)).rejects.toThrow("identity conflict");
    expect((await query("SELECT user_id FROM investment_reservations WHERE id=10")).rows[0].user_id).toBe(1);
  });
  it("rejects unverified KYC and does not overwrite approved destination evidence", async () => {
    await query("UPDATE users SET kyc_status='submitted' WHERE id=1");
    expect((await previewConsolidation({ query }, 1, 2)).blockers.join()).toContain("approved KYC");
  });
  it.each([
    "INSERT INTO resale_listings VALUES(1,1,10,'active')",
    "INSERT INTO legal_document_pairs VALUES(1,1,10)",
    "INSERT INTO local_legal_signing_operations VALUES(1,2)",
    "CREATE TABLE unexpected_work(id integer,user_id integer references users(id)); INSERT INTO unexpected_work VALUES(1,1)",
    "CREATE TABLE unexpected_holding_work(id integer,holding_ref integer references investment_reservations(id)); INSERT INTO unexpected_holding_work VALUES(1,10)",
    "UPDATE payment_submissions SET status='pending'",
  ])("fails closed for linked work: %s", async sql => {
    const instructions = await input();
    await db.exec(sql);
    await expect(executeConsolidation({ query }, instructions, 1)).rejects.toThrow();
    expect((await query("SELECT * FROM account_consolidations")).rows).toHaveLength(0);
  });
  it("rolls back owner/contact/disable changes when a legal database guard rejects the update", async () => {
    const instructions = await input();
    await db.exec(`CREATE FUNCTION deny_owner_change() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'retained legal history'; END; $$;
      CREATE TRIGGER retained_history BEFORE UPDATE ON investment_reservations FOR EACH ROW EXECUTE FUNCTION deny_owner_change();`);
    await expect(executeConsolidation({ query }, instructions, 1)).rejects.toThrow("retained legal history");
    expect((await query("SELECT user_id,email FROM investment_reservations WHERE id=10")).rows[0]).toEqual({ user_id: 1, email: "old-contact@example.test" });
    expect((await query("SELECT is_active FROM users WHERE id=1")).rows[0].is_active).toBe(true);
    expect((await query("SELECT * FROM account_consolidations")).rows).toHaveLength(0);
  });
  it("rolls back all changes if audit creation fails", async () => {
    await expect(executeConsolidation({ query }, await input(), 999)).rejects.toThrow();
    expect((await query("SELECT user_id FROM investment_reservations WHERE id=10")).rows[0].user_id).toBe(1);
    expect((await query("SELECT is_active FROM users WHERE id=1")).rows[0].is_active).toBe(true);
  });
  it("rejects stale previews and absent confirmation", async () => {
    const instructions = await input();
    await query("UPDATE investment_reservations SET amount=1008001 WHERE id=10");
    await expect(executeConsolidation({ query }, instructions, 1)).rejects.toThrow("data changed");
    await expect(executeConsolidation({ query }, { ...await input(), identityVerified: false as any }, 1)).rejects.toThrow("Explicit identity");
  });
  it("keeps historical operational email when not explicitly selected", async () => {
    await executeConsolidation({ query }, { ...await input(), updateContactEmail: false }, 1);
    expect((await query("SELECT email FROM investment_reservations WHERE id=10")).rows[0].email).toBe("old-contact@example.test");
    await expect(query("DELETE FROM account_consolidations")).rejects.toThrow("immutable");
  });
  it("does not leak passwords or full government ID numbers in previews", async () => {
    const preview = await previewConsolidation({ query }, 1, 2);
    expect(JSON.stringify(preview)).not.toContain("TEST-IDENTITY");
    expect(preview.source.kycIdNumber).toBe("••••TITY");
  });
  it("allows concurrent identical submissions exactly once", async () => {
    // PGlite serializes transactions through its transaction API; exercise
    // simultaneous callers using separate transaction wrappers on one engine.
    const instructions = await input();
    const calls = [0, 1].map(() => db.transaction(async tx => {
      const client = { query: async (sql: string, values?: any[]) => {
        if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [] };
        return tx.query<any>(sql, values);
      } };
      return executeConsolidation(client, instructions, 1);
    }));
    const results = await Promise.all(calls);
    expect(results[0]).toEqual(results[1]);
    expect((await query("SELECT * FROM account_consolidations")).rows).toHaveLength(1);
  });
});
