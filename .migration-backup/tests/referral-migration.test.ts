import fs from "node:fs/promises";
import { Pool, neonConfig } from "@neondatabase/serverless";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import ws from "ws";

neonConfig.webSocketConstructor = ws;

const schemaName = `__brikvest_test__referral_migration_${Date.now()}`;
const pool = new Pool({
  connectionString: process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL,
});
let cleanupSql: string;

beforeAll(async () => {
  cleanupSql = await fs.readFile("scripts/remove-referral-program.sql", "utf8");
  await pool.query(`CREATE SCHEMA "${schemaName}"`);
});

afterAll(async () => {
  await pool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  await pool.end();
});

describe("referral schema cleanup migration", () => {
  it("removes a populated legacy schema and is safe to run again", async () => {
    const client = await pool.connect();
    try {
      await client.query(`SET search_path TO "${schemaName}"`);
      await client.query(`
        CREATE TABLE users (
          id serial PRIMARY KEY,
          referral_code text,
          referred_by_user_id integer
        );
        CREATE TABLE investment_reservations (
          id serial PRIMARY KEY,
          referral_code text
        );
        CREATE TABLE referrals (
          id serial PRIMARY KEY,
          referrer_user_id integer,
          referred_user_id integer
        );
        CREATE TABLE referral_rewards (
          id serial PRIMARY KEY,
          referral_id integer,
          reward_amount numeric
        );
        INSERT INTO users (referral_code, referred_by_user_id)
          VALUES ('BRIK-LEGACY', 1);
        INSERT INTO investment_reservations (referral_code)
          VALUES ('BRIK-LEGACY');
        INSERT INTO referrals (referrer_user_id, referred_user_id)
          VALUES (1, 2);
        INSERT INTO referral_rewards (referral_id, reward_amount)
          VALUES (1, 1000);
      `);

      await client.query(cleanupSql);
      await client.query(cleanupSql);

      const result = await client.query(
        `
          SELECT table_name, column_name
          FROM information_schema.columns
          WHERE table_schema = $1
            AND (
              table_name IN ('referrals', 'referral_rewards')
              OR (
                table_name = 'users'
                AND column_name IN ('referral_code', 'referred_by_user_id')
              )
              OR (
                table_name = 'investment_reservations'
                AND column_name = 'referral_code'
              )
            )
        `,
        [schemaName],
      );

      expect(result.rows).toEqual([]);
    } finally {
      client.release();
    }
  });
});