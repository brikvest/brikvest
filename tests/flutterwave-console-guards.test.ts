import fs from "node:fs/promises";
import {PGlite} from "@electric-sql/pglite";
import {describe, expect, it} from "vitest";

describe("reviewed owner-console payment guards", () => {
  it("installs the exact reviewed bodies, preserves purchases and refuses blind replay", async () => {
    const pg = new PGlite();
    try {
      await pg.exec(`
        CREATE TABLE users(id integer PRIMARY KEY);
        CREATE TABLE admin_users(id integer PRIMARY KEY);
        CREATE TABLE investment_reservations(id integer PRIMARY KEY,property_id integer,
          units numeric,amount numeric,currency text,status text,cost_basis jsonb);
        INSERT INTO users VALUES(1);
        INSERT INTO investment_reservations VALUES(1,1,1,1200.10,'NGN','converted_to_investment',NULL);
      `);
      const contract = await fs.readFile("scripts/ensure-flutterwave.sql","utf8");
      // Install only managed tables in the disposable database; guards must come from the reviewed draft.
      await pg.exec(contract.split("CREATE OR REPLACE FUNCTION")[0] + "COMMIT;");
      const document = await fs.readFile("docs/flutterwave-production-guards-console.md","utf8");
      const productionSQL = document.match(/```sql\n([\s\S]*?)```/)![1];
      // Only the explicit database-identity assertion changes for PGlite's fixed database name.
      const fixtureSQL = productionSQL.replace("current_database() <> 'neondb'", "current_database() <> 'postgres'");
      await pg.exec(fixtureSQL);
      const hashes = (await pg.query<{proname:string;hash:string}>(`SELECT proname,md5(prosrc) AS hash FROM pg_proc
        WHERE proname IN ('protect_flutterwave_expected','guard_holding_cost_basis')`)).rows;
      expect(Object.fromEntries(hashes.map(row => [row.proname,row.hash]))).toEqual({
        protect_flutterwave_expected:"e6e632dfa8a00362e9d70f45a46b7d02",
        guard_holding_cost_basis:"9639dd1f6a65cf9bff769a4e3bb3eba3",
      });
      await pg.exec(`INSERT INTO flutterwave_attempts(reservation_id,user_id,tx_ref,expected_amount,expected_currency,mode,checkout_expires_at)
        VALUES(1,1,'fixture',1200.10,'NGN','live',now()+interval '10 minutes')`);
      await expect(pg.exec("UPDATE flutterwave_attempts SET expected_amount=1")).rejects.toThrow("immutable");
      await expect(pg.exec(`UPDATE investment_reservations SET cost_basis='{}'`)).rejects.toThrow("Historical cost basis");
      expect((await pg.query<{amount:string;cost_basis:null}>("SELECT amount,cost_basis FROM investment_reservations")).rows)
        .toEqual([{amount:"1200.10",cost_basis:null}]);
      await expect(pg.exec(fixtureSQL)).rejects.toThrow("already exists");
      await pg.exec("ROLLBACK;");
    } finally { await pg.close(); }
  });
});
