import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { insertPropertySchema, properties } from "../shared/schema";
import { isCalendarDate, formatCalendarDate } from "../shared/calendar-date";

const property = {
  name: "Isolated property", location: "Abuja", description: "Isolated date fixture",
  totalValue: 10000, minInvestment: 1000, totalSlots: 10, availableSlots: 10,
  imageUrl: "/fixture.svg",
};

describe("property calendar dates", () => {
  it("accepts omitted, null and valid dates", () => {
    expect(insertPropertySchema.parse(property)).not.toHaveProperty("sellDate");
    for (const sellDate of [null, "2028-02-29", "2026-10-10", "0001-01-01", "9999-12-31"]) {
      expect(insertPropertySchema.parse({ ...property, sellDate }).sellDate).toBe(sellDate);
    }
  });

  it.each(["", "2026-02-29", "2026-04-31", "1900-02-29", "0000-01-01",
    "2026-13-01", "2026-00-01", "2026-01-00", "2026-1-01",
    "2026-10-10T00:00:00Z", " 2026-10-10", 123, {}, new Date()])("rejects invalid input %s", (sellDate) => {
    expect(insertPropertySchema.safeParse({ ...property, sellDate }).success).toBe(false);
  });

  it("formats independently of time zone without parsing an instant", () => {
    for (const zone of ["Pacific/Honolulu", "Pacific/Kiritimati", "UTC"]) {
      const previous = process.env.TZ;
      try {
        process.env.TZ = zone;
        expect(formatCalendarDate("2028-02-29")).toBe("29 February 2028");
        expect(formatCalendarDate("0001-01-01")).toBe("1 January 0001");
      } finally {
        if (previous === undefined) delete process.env.TZ;
        else process.env.TZ = previous;
      }
    }
    expect(isCalendarDate("2000-02-29")).toBe(true);
  });

  it("reruns the exact additive migration safely and preserves legacy rows", async () => {
    const pg = new PGlite();
    try {
      await pg.exec("CREATE TABLE public.properties (id serial PRIMARY KEY, name text NOT NULL); INSERT INTO properties (name) VALUES ('Legacy');");
      const migration = readFileSync("scripts/ensure-property-sell-date.sql", "utf8");
      await pg.exec(migration);
      await pg.exec(migration);
      expect((await pg.query("SELECT * FROM properties")).rows).toEqual([{ id: 1, name: "Legacy", sell_date: null }]);
      expect((await pg.query("SELECT data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name = 'properties' AND column_name = 'sell_date'")).rows)
        .toEqual([{ data_type: "date", is_nullable: "YES", column_default: null }]);
      const db = drizzle(pg);
      // Use the real Drizzle column mapping, but select only fixture columns.
      await db.update(properties).set({ sellDate: "2028-02-29" }).where(eq(properties.id, 1));
      await db.update(properties).set({ name: "Unrelated edit", sellDate: undefined }).where(eq(properties.id, 1));
      expect((await db.select({ sellDate: properties.sellDate }).from(properties))[0].sellDate).toBe("2028-02-29");
      await db.update(properties).set({ sellDate: "2029-01-01" }).where(eq(properties.id, 1));
      expect((await db.select({ sellDate: properties.sellDate }).from(properties))[0].sellDate).toBe("2029-01-01");
      await db.update(properties).set({ sellDate: null }).where(eq(properties.id, 1));
      expect((await db.select({ sellDate: properties.sellDate }).from(properties))[0].sellDate).toBeNull();
      await pg.exec(migration);
      expect((await pg.query("SELECT name, sell_date FROM properties")).rows).toEqual([{ name: "Unrelated edit", sell_date: null }]);
    } finally { await pg.close(); }
  });
});
