import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import { objectStorageClient } from "../server/objectStorage";

neonConfig.webSocketConstructor = ws;

const SNAPSHOT_KIND = "brikvest-data-retirement/referral-program-v1";
const SNAPSHOT_FILENAME = "referral-program-pre-removal.json";

function privateSnapshotTarget() {
  const privateDir = process.env.PRIVATE_OBJECT_DIR;
  if (!privateDir) {
    throw new Error("PRIVATE_OBJECT_DIR is required before referral data can be removed");
  }

  const parts = privateDir.replace(/^\/+|\/+$/g, "").split("/");
  const bucketName = parts.shift();
  if (!bucketName) throw new Error("PRIVATE_OBJECT_DIR does not contain a bucket name");

  return {
    bucketName,
    objectName: [...parts, "data-retirement", SNAPSHOT_FILENAME].join("/"),
  };
}

async function collectLegacySnapshot(pool: Pool) {
  const inventory = await pool.query<{
    table_name: string;
    column_name: string;
    data_type: string;
    is_nullable: string;
    column_default: string | null;
  }>(`
    SELECT table_name, column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (
        table_name IN ('referrals', 'referral_rewards')
        OR (table_name = 'users' AND column_name IN ('referral_code', 'referred_by_user_id'))
        OR (table_name = 'investment_reservations' AND column_name = 'referral_code')
      )
    ORDER BY table_name, ordinal_position
  `);

  if (inventory.rows.length === 0) return null;

  const hasTable = (name: string) =>
    inventory.rows.some((row) => row.table_name === name);
  const hasColumn = (table: string, column: string) =>
    inventory.rows.some(
      (row) => row.table_name === table && row.column_name === column,
    );

  const referrals = hasTable("referrals")
    ? (await pool.query("SELECT * FROM referrals ORDER BY id")).rows
    : [];
  const rewards = hasTable("referral_rewards")
    ? (await pool.query("SELECT * FROM referral_rewards ORDER BY id")).rows
    : [];
  const userAttribution =
    hasColumn("users", "referral_code") ||
    hasColumn("users", "referred_by_user_id")
      ? (
          await pool.query(`
            SELECT id,
              ${hasColumn("users", "referral_code") ? "referral_code" : "NULL::text AS referral_code"},
              ${hasColumn("users", "referred_by_user_id") ? "referred_by_user_id" : "NULL::integer AS referred_by_user_id"}
            FROM users
            WHERE
              ${hasColumn("users", "referral_code") ? "referral_code IS NOT NULL" : "FALSE"}
              OR ${hasColumn("users", "referred_by_user_id") ? "referred_by_user_id IS NOT NULL" : "FALSE"}
            ORDER BY id
          `)
        ).rows
      : [];
  const reservationAttribution = hasColumn(
    "investment_reservations",
    "referral_code",
  )
    ? (
        await pool.query(`
          SELECT id, referral_code
          FROM investment_reservations
          WHERE referral_code IS NOT NULL
          ORDER BY id
        `)
      ).rows
    : [];

  return {
    kind: SNAPSHOT_KIND,
    capturedAt: new Date().toISOString(),
    schema: inventory.rows,
    referrals,
    referralRewards: rewards,
    userAttribution,
    reservationAttribution,
  };
}

async function savePrivateSnapshot(snapshot: unknown) {
  const content = JSON.stringify(snapshot, null, 2);
  const checksum = createHash("sha256").update(content).digest("hex");
  const { bucketName, objectName } = privateSnapshotTarget();
  const file = objectStorageClient.bucket(bucketName).file(objectName);
  const [exists] = await file.exists();

  if (exists) {
    const [stored] = await file.download();
    const parsed = JSON.parse(stored.toString("utf8"));
    if (parsed.kind !== SNAPSHOT_KIND) {
      throw new Error("Existing retirement snapshot has an unexpected format");
    }
    console.log("Private referral retirement snapshot already exists.");
    return;
  }

  await file.save(content, {
    resumable: false,
    preconditionOpts: { ifGenerationMatch: 0 },
    metadata: {
      contentType: "application/json",
      cacheControl: "private, no-store",
      metadata: {
        snapshotKind: SNAPSHOT_KIND,
        sha256: checksum,
      },
    },
  });

  const [stored] = await file.download();
  const storedChecksum = createHash("sha256").update(stored).digest("hex");
  if (storedChecksum !== checksum) {
    throw new Error("Private referral retirement snapshot verification failed");
  }

  console.log("Created and verified private referral retirement snapshot.");
}

async function main() {
  const preservedSnapshotPath = process.env.REFERRAL_SNAPSHOT_INPUT;
  if (preservedSnapshotPath) {
    const preserved = await fs.readFile(preservedSnapshotPath, "utf8");
    await savePrivateSnapshot({
      kind: SNAPSHOT_KIND,
      capturedAt: new Date().toISOString(),
      source: "pre-removal-export",
      export: preserved,
    });
    return;
  }

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const snapshot = await collectLegacySnapshot(pool);
    if (!snapshot) {
      console.log("Referral schema is already absent; no backup is needed.");
      return;
    }
    await savePrivateSnapshot(snapshot);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});