import { describe, expect, it } from "vitest";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { flutterwaveAttempts } from "../shared/schema";

describe("Flutterwave declarative rollout guards", () => {
  it("includes the SQL rollout's positive amount and environment constraints", () => {
    const { checks } = getTableConfig(flutterwaveAttempts);
    const dialect = new PgDialect();
    const clauses = Object.fromEntries(checks.map(c => [c.name, dialect.sqlToQuery(c.value).sql]));
    expect(clauses.flutterwave_attempts_expected_amount_check).toContain('"expected_amount" > 0');
    expect(clauses.flutterwave_attempts_mode_check).toContain('"mode" IN (\'test\',\'live\')');
  });

  it("declares one unresolved checkout per reservation as a partial unique index", () => {
    const { indexes } = getTableConfig(flutterwaveAttempts);
    const index = indexes.find(i => i.config.name === "flutterwave_one_open_attempt");
    expect(index?.config.unique).toBe(true);
    expect(index?.config.columns.map(c => "name" in c ? c.name : undefined)).toEqual(["reservation_id"]);
    expect(index?.config.where).toBeDefined();
    expect(new PgDialect().sqlToQuery(index!.config.where!).sql)
      .toContain('"state" IN (\'initiated\',\'verification_pending\')');
  });
});
