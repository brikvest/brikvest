import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const databaseRef = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("../server/db", () => ({
  get db() {
    return databaseRef.current;
  },
}));

const investorName = "Verified Inventory Investor";
const investorAddress = "12 Inventory Way, Abuja";

let pglite: PGlite;
let testDb: ReturnType<typeof drizzle>;
let storage: import("../server/storage").DatabaseStorage;
let ownerId: number;
let adminId: number;
let sd118PropertyId: number;
let otherPropertyId: number;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function seedDatabase(): Promise<void> {
  await pglite.exec(`
    CREATE TABLE users (
      id serial PRIMARY KEY,
      email text NOT NULL UNIQUE,
      password text,
      kyc_status text NOT NULL,
      kyc_full_name text,
      kyc_address text
    );
    CREATE TABLE admin_users (id serial PRIMARY KEY);
    CREATE TABLE properties (
      id serial PRIMARY KEY,
      name text NOT NULL,
      location text NOT NULL,
      currency text NOT NULL DEFAULT 'NGN',
      unit_land_cost numeric(15,2) NOT NULL DEFAULT 1000,
      unit_agent_fees numeric(15,2) NOT NULL DEFAULT 0,
      unit_due_diligence_cost numeric(15,2) NOT NULL DEFAULT 0,
      unit_service_charge numeric(15,2) NOT NULL DEFAULT 0,
      total_slots integer NOT NULL DEFAULT 0,
      available_slots integer NOT NULL DEFAULT 0,
      funding_progress integer NOT NULL DEFAULT 0,
      total_units integer NOT NULL DEFAULT 0,
      reserved_units integer NOT NULL DEFAULT 0,
      sold_units integer NOT NULL DEFAULT 0
    );
    CREATE TABLE investment_reservations (
      id serial PRIMARY KEY,
      property_id integer NOT NULL REFERENCES properties(id),
      user_id integer REFERENCES users(id),
      full_name text NOT NULL,
      email text NOT NULL,
      phone text NOT NULL,
      units numeric(15,2) NOT NULL,
      amount numeric(20,2) NOT NULL,
      currency text NOT NULL DEFAULT 'NGN',
      unit_price_snapshot numeric(15,2) NOT NULL,
      unit_type_label text,
      status text NOT NULL DEFAULT 'reserved',
      funnel_stage text,
      last_reminder_sent_at timestamptz,
      payment_method text,
      payment_reference text,
      payment_evidence_url text,
      created_by_admin_id integer,
      notes text,
      expires_at timestamptz,
      kyc_extended_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE payment_submissions (
      id serial PRIMARY KEY,
      reservation_id integer NOT NULL REFERENCES investment_reservations(id),
      user_id integer NOT NULL REFERENCES users(id),
      amount numeric(20,2) NOT NULL,
      currency text NOT NULL,
      status text NOT NULL,
      reviewed_at timestamptz,
      reviewed_by_admin_id integer REFERENCES admin_users(id)
    );
    INSERT INTO users (email,password,kyc_status,kyc_full_name,kyc_address)
      VALUES ('inventory.investor@example.test','unused','approved',
        '${investorName}','${investorAddress}');
    INSERT INTO admin_users DEFAULT VALUES;
    INSERT INTO properties (name,location,total_slots,available_slots,total_units)
      VALUES ('SD118','Abuja',5,5,5), ('Other Estate','Lagos',5,5,5);
  `);
  await pglite.exec(await fs.readFile(
    "scripts/ensure-investment-reservation-inventory-accounting.sql",
    "utf8",
  ));
  await pglite.exec(await fs.readFile("scripts/ensure-legal-documents.sql", "utf8"));

  const ids = await pglite.query<{
    owner_id: number;
    admin_id: number;
    sd118_property_id: number;
    other_property_id: number;
  }>(`
    SELECT
      (SELECT id FROM users LIMIT 1) AS owner_id,
      (SELECT id FROM admin_users LIMIT 1) AS admin_id,
      (SELECT id FROM properties WHERE name = 'SD118') AS sd118_property_id,
      (SELECT id FROM properties WHERE name = 'Other Estate') AS other_property_id
  `);
  ownerId = ids.rows[0].owner_id;
  adminId = ids.rows[0].admin_id;
  sd118PropertyId = ids.rows[0].sd118_property_id;
  otherPropertyId = ids.rows[0].other_property_id;

  await pglite.exec(`
    INSERT INTO legal_property_bindings
      (property_id,document_scope,enabled,square_meters_per_unit,note,bound_by_admin_id)
    VALUES (${sd118PropertyId},'SD118',true,5,'Exact SD118 test binding',${adminId});
    INSERT INTO legal_templates
      (document_type,version,original_filename,storage_key,sha256,byte_size,
       validation_status,is_active,created_by_admin_id,activated_at)
    VALUES
      ('deed_of_assignment',1,'deed.docx','legal/templates/deed/v1',
       '${sha256("deed template")}',100,'valid',true,${adminId},now()),
      ('transfer_exit_rights',1,'transfer.docx','legal/templates/transfer/v1',
       '${sha256("transfer template")}',100,'valid',true,${adminId},now());
  `);
  await pglite.exec(await fs.readFile("scripts/ensure-legal-property-templates.sql", "utf8"));
}

async function createReservationAndPayment(
  propertyId: number,
  paymentAmount = "1000",
) {
  const reservation = await storage.createInvestmentReservation({
    propertyId,
    userId: ownerId,
    fullName: investorName,
    email: "inventory.investor@example.test",
    phone: "+2348000000000",
    units: "1",
    amount: "1000",
    currency: "NGN",
    unitPriceSnapshot: "1000",
    status: "reserved",
  }, { accountInventoryAtomically: true });
  const payment = await pglite.query<{ id: number }>(`
    INSERT INTO payment_submissions
      (reservation_id,user_id,amount,currency,status)
    VALUES (${reservation.id},${ownerId},${paymentAmount},'NGN','pending_admin_review')
    RETURNING id
  `);
  return { reservation, submissionId: payment.rows[0].id };
}

async function propertyInventory(propertyId: number) {
  return (await pglite.query<{
    available_slots: number;
    reserved_units: number;
    sold_units: number;
  }>(`
    SELECT available_slots,reserved_units,sold_units
    FROM properties WHERE id=${propertyId}
  `)).rows[0];
}

beforeEach(async () => {
  await pglite?.close();
  pglite = new PGlite();
  testDb = drizzle(pglite);
  databaseRef.current = testDb;
  await seedDatabase();
  const { DatabaseStorage } = await import("../server/storage");
  storage = new DatabaseStorage();
});

afterAll(async () => {
  await pglite?.close();
});

describe("reservation inventory to legal approval (isolated PGlite)", () => {
  it("keeps core reservation reads independent of the optional side-ledger migration", async () => {
    const legacy = await pglite.query<{ id: number }>(`
      INSERT INTO investment_reservations (
        property_id,user_id,full_name,email,phone,units,amount,currency,
        unit_price_snapshot,status,funnel_stage
      ) VALUES (
        ${otherPropertyId},${ownerId},'Legacy Investor','legacy@example.test',
        '+2348000000001',1,1000,'NGN',1000,'reserved','prospective'
      ) RETURNING id
    `);
    await pglite.exec("DROP TABLE investment_reservation_inventory");
    expect((await storage.getReservation(legacy.rows[0].id))?.id).toBe(legacy.rows[0].id);
    await expect(storage.createInvestmentReservation({
      propertyId: otherPropertyId,
      userId: ownerId,
      fullName: investorName,
      email: "inventory.investor@example.test",
      phone: "+2348000000000",
      units: "1",
      amount: "1000",
      currency: "NGN",
      unitPriceSnapshot: "1000",
      status: "reserved",
    }, { accountInventoryAtomically: true })).rejects.toThrow(/migration is required/i);
    expect(await propertyInventory(otherPropertyId)).toEqual({
      available_slots: 5,
      reserved_units: 0,
      sold_units: 0,
    });
  });

  it("wires public, admin, and CRM reserved-entry handlers to atomic claims without duplicate counter updates", async () => {
    const source = await fs.readFile("server/routes.ts", "utf8");
    const routeBlock = (marker: string) => {
      const start = source.indexOf(marker);
      expect(start).toBeGreaterThanOrEqual(0);
      const next = source.indexOf("\n  app.", start + marker.length);
      return source.slice(start, next < 0 ? source.length : next);
    };
    const publicRoute = routeBlock('app.post("/api/reservations"');
    const adminRoute = routeBlock("app.post('/api/admin/investments/create'");
    const crmRoute = routeBlock('app.post("/api/developer/projects/:id/leads/:leadId/convert"');

    for (const route of [publicRoute, adminRoute, crmRoute]) {
      expect(route).toMatch(/createInvestmentReservation[\s\S]*accountInventoryAtomically:\s*true/);
      expect(route).not.toMatch(/updatePropertyUnitCounts\s*\([^)]*,\s*(?:requestedUnits|units)\s*,\s*0\s*\)/);
    }
    expect(publicRoute).toMatch(/Number\.isInteger\(requestedUnits\)[\s\S]*createInvestmentReservation/);
    expect(adminRoute).toMatch(/Number\.isInteger\(requestedUnits\)[\s\S]*createInvestmentReservation/);
    expect(crmRoute).toMatch(/Number\.isInteger\(units\)[\s\S]*createInvestmentReservation/);

    const directSaleStart = source.indexOf("// Create a fully confirmed reservation directly.");
    const directSaleNextRoute = source.indexOf("\n  app.", directSaleStart);
    const directSaleRoute = source.slice(directSaleStart, directSaleNextRoute);
    expect(directSaleRoute).toMatch(/status:\s*"converted_to_investment"/);
    expect(directSaleRoute).not.toMatch(/accountInventoryAtomically/);
  });

  it("atomically reserves real SD118 capacity and queues legal approval exactly once", async () => {
    const before = await propertyInventory(sd118PropertyId);
    expect(before.reserved_units).toBe(0);

    const { reservation, submissionId } = await createReservationAndPayment(sd118PropertyId);
    const provenance = await pglite.query<{ reserved_units: string }>(`
      SELECT reserved_units::text FROM investment_reservation_inventory
      WHERE reservation_id=${reservation.id}
    `);
    expect(provenance.rows[0].reserved_units).toBe("1.00");
    expect(await propertyInventory(sd118PropertyId)).toEqual({
      available_slots: 4,
      reserved_units: 1,
      sold_units: 0,
    });

    const { approvePaymentSubmissionAtomically } = await import("../server/legal/approval");
    const results = await Promise.allSettled([
      approvePaymentSubmissionAtomically(submissionId, adminId),
      approvePaymentSubmissionAtomically(submissionId, adminId),
    ]);
    const committed = results.filter((result) => result.status === "fulfilled");
    expect(committed).toHaveLength(1);
    if (committed[0].status !== "fulfilled") throw new Error("Expected one committed approval.");
    expect(committed[0].value.legal).toMatchObject({
      eligible: true,
      status: "queued",
    });
    expect(await propertyInventory(sd118PropertyId)).toEqual({
      available_slots: 4,
      reserved_units: 0,
      sold_units: 1,
    });
    const pairCount = await pglite.query<{ count: number }>(`
      SELECT count(*)::int AS count FROM legal_document_pairs
      WHERE reservation_id=${reservation.id}
    `);
    expect(pairCount.rows[0].count).toBe(1);
  });

  it("creates and approves a non-SD118 reservation from an initially zero reserved-unit counter", async () => {
    expect((await propertyInventory(otherPropertyId)).reserved_units).toBe(0);
    const { reservation, submissionId } = await createReservationAndPayment(otherPropertyId);
    expect((await propertyInventory(otherPropertyId)).reserved_units).toBe(1);

    const { approvePaymentSubmissionAtomically } = await import("../server/legal/approval");
    const approval = await approvePaymentSubmissionAtomically(submissionId, adminId);
    expect(approval.legal).toMatchObject({
      eligible: true,
      status: "awaiting_templates",
    });
    expect(await propertyInventory(otherPropertyId)).toEqual({
      available_slots: 4,
      reserved_units: 0,
      sold_units: 1,
    });
    const account = await pglite.query<{ reserved_units: string }>(`
      SELECT reserved_units::text FROM investment_reservation_inventory
      WHERE reservation_id=${reservation.id}
    `);
    expect(account.rows[0].reserved_units).toBe("0.00");
  });

  it("approves a legacy zero-counter holding without consuming a different reservation's marked units", async () => {
    const tracked = await createReservationAndPayment(otherPropertyId);
    const legacy = await pglite.query<{ id: number }>(`
      INSERT INTO investment_reservations (
        property_id,user_id,full_name,email,phone,units,amount,currency,
        unit_price_snapshot,status,funnel_stage
      ) VALUES (
        ${otherPropertyId},${ownerId},'Legacy Investor','legacy@example.test',
        '+2348000000001',1,1000,'NGN',1000,'reserved','prospective'
      ) RETURNING id
    `);
    const legacyPayment = await pglite.query<{ id: number }>(`
      INSERT INTO payment_submissions
        (reservation_id,user_id,amount,currency,status)
      VALUES (${legacy.rows[0].id},${ownerId},1000,'NGN','pending_admin_review')
      RETURNING id
    `);

    const { approvePaymentSubmissionAtomically } = await import("../server/legal/approval");
    await approvePaymentSubmissionAtomically(legacyPayment.rows[0].id, adminId);
    expect(await propertyInventory(otherPropertyId)).toEqual({
      available_slots: 4,
      reserved_units: 1,
      sold_units: 1,
    });
    await approvePaymentSubmissionAtomically(tracked.submissionId, adminId);
    expect(await propertyInventory(otherPropertyId)).toEqual({
      available_slots: 4,
      reserved_units: 0,
      sold_units: 2,
    });
  });

  it("reinstates an expired legacy holding without requiring or consuming reserved_units", async () => {
    const legacy = await pglite.query<{ id: number }>(`
      INSERT INTO investment_reservations (
        property_id,user_id,full_name,email,phone,units,amount,currency,
        unit_price_snapshot,status,funnel_stage,expires_at
      ) VALUES (
        ${sd118PropertyId},${ownerId},'Legacy Investor','legacy@example.test',
        '+2348000000001',1,1000,'NGN',1000,'expired',NULL,
        now() - interval '1 day'
      ) RETURNING id
    `);
    const { reinstateInvestmentAtomically } = await import("../server/legal/approval");
    const result = await reinstateInvestmentAtomically(
      legacy.rows[0].id,
      adminId,
      "LEGACY-REINSTATE-1",
      "bank_transfer",
      "Verified full-payment reinstatement",
      {
        fullPaymentConfirmed: true,
        amountNaira: "1000",
        currency: "NGN",
        auditNote: "Verified receipt and current available capacity",
      },
    );
    expect(result.legal).toMatchObject({ eligible: true, status: "queued" });
    expect(await propertyInventory(sd118PropertyId)).toEqual({
      available_slots: 4,
      reserved_units: 0,
      sold_units: 1,
    });
  });

  it("rejects concurrent reservations that exceed available capacity without overselling", async () => {
    await pglite.query(`
      UPDATE properties SET total_slots=2,available_slots=2,total_units=2
      WHERE id=${sd118PropertyId}
    `);
    const createFromSource = (source: string) => storage.createInvestmentReservation({
        propertyId: sd118PropertyId,
        userId: ownerId,
        fullName: `${investorName} ${source}`,
        email: `${source.toLowerCase()}@inventory.example.test`,
        phone: "+2348000000000",
        units: "1",
        amount: "1000",
        currency: "NGN",
        unitPriceSnapshot: "1000",
        status: "reserved",
      }, { accountInventoryAtomically: true });
    const attempts = await Promise.allSettled([
      createFromSource("Admin"),
      createFromSource("CRM"),
      createFromSource("Public"),
    ]);
    expect(attempts.filter((result) => result.status === "fulfilled")).toHaveLength(2);
    expect(attempts.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await propertyInventory(sd118PropertyId)).toEqual({
      available_slots: 0,
      reserved_units: 2,
      sold_units: 0,
    });
    const reservations = await pglite.query<{ count: number }>(`
      SELECT count(*)::int AS count FROM investment_reservations
      WHERE property_id=${sd118PropertyId} AND status='reserved'
    `);
    expect(reservations.rows[0].count).toBe(2);
  });

  it("rejects fractional atomic reservations before inserting or changing inventory", async () => {
    await expect(storage.createInvestmentReservation({
      propertyId: sd118PropertyId,
      userId: ownerId,
      fullName: investorName,
      email: "fractional@inventory.example.test",
      phone: "+2348000000000",
      units: "1.5",
      amount: "1500",
      currency: "NGN",
      unitPriceSnapshot: "1000",
      status: "reserved",
    }, { accountInventoryAtomically: true })).rejects.toThrow(/fractional/i);

    expect(await propertyInventory(sd118PropertyId)).toEqual({
      available_slots: 5,
      reserved_units: 0,
      sold_units: 0,
    });
    const inserted = await pglite.query<{ count: number }>(`
      SELECT count(*)::int AS count FROM investment_reservations
      WHERE email='fractional@inventory.example.test'
    `);
    expect(inserted.rows[0].count).toBe(0);
    const ledgerRows = await pglite.query<{ count: number }>(`
      SELECT count(*)::int AS count FROM investment_reservation_inventory i
      JOIN investment_reservations r ON r.id=i.reservation_id
      WHERE r.email='fractional@inventory.example.test'
    `);
    expect(ledgerRows.rows[0].count).toBe(0);
  });

  it("cancellation releases its own marked counter contribution exactly once", async () => {
    const { reservation } = await createReservationAndPayment(sd118PropertyId);
    storage.getProperty = async () => ({ totalSlots: 5 } as any);
    await storage.updateReservation(reservation.id, { status: "cancelled" });
    await storage.updatePropertyUnitCounts(sd118PropertyId, -1, 0);

    expect(await propertyInventory(sd118PropertyId)).toEqual({
      available_slots: 5,
      reserved_units: 0,
      sold_units: 0,
    });
    const account = await pglite.query<{ reserved_units: string; release_pending: boolean }>(`
      SELECT reserved_units::text,release_pending
      FROM investment_reservation_inventory WHERE reservation_id=${reservation.id}
    `);
    expect(account.rows[0]).toEqual({ reserved_units: "0.00", release_pending: false });
  });

  it("runs the unsigned legal-history cancellation gate before reverting confirmed inventory", async () => {
    const { reservation, submissionId } = await createReservationAndPayment(sd118PropertyId);
    const { approvePaymentSubmissionAtomically, cancelConfirmedInvestmentAtomically } =
      await import("../server/legal/approval");
    await approvePaymentSubmissionAtomically(submissionId, adminId);

    const cancelled = await cancelConfirmedInvestmentAtomically(reservation.id, adminId);
    expect(cancelled.legalCancellation).toMatchObject({
      reservationId: reservation.id,
      policy: "unsigned_signing_suspended",
    });
    expect(await propertyInventory(sd118PropertyId)).toEqual({
      available_slots: 5,
      reserved_units: 0,
      sold_units: 0,
    });
    const audit = await pglite.query<{ count: number }>(`
      SELECT count(*)::int AS count FROM legal_audit_events
      WHERE reservation_id=${reservation.id}
        AND event_type='legal_unsigned_signing_suspended_by_holding_cancellation'
    `);
    expect(audit.rows[0].count).toBe(1);
  });

  it("legacy cancellation with no provable counter does not consume a different marked reservation", async () => {
    const first = await createReservationAndPayment(sd118PropertyId);
    const second = await createReservationAndPayment(sd118PropertyId);
    await pglite.exec(`
      DELETE FROM investment_reservation_inventory WHERE reservation_id=${first.reservation.id};
      UPDATE properties SET reserved_units=1 WHERE id=${sd118PropertyId}
    `);
    storage.getProperty = async () => ({ totalSlots: 5 } as any);
    await storage.updateReservation(first.reservation.id, { status: "cancelled" });
    await storage.updatePropertyUnitCounts(sd118PropertyId, -1, 0);

    expect(await propertyInventory(sd118PropertyId)).toEqual({
      available_slots: 4,
      reserved_units: 1,
      sold_units: 0,
    });
    const remaining = await pglite.query<{ reserved_units: string }>(`
      SELECT reserved_units::text FROM investment_reservation_inventory
      WHERE reservation_id=${second.reservation.id}
    `);
    expect(remaining.rows[0].reserved_units).toBe("1.00");
  });

  it("expiry releases its own marked counter contribution without touching other reservations", async () => {
    const { reservation, submissionId } = await createReservationAndPayment(sd118PropertyId);
    await pglite.exec(`
      UPDATE payment_submissions SET status='rejected' WHERE id=${submissionId};
      UPDATE investment_reservations
      SET expires_at=now() - interval '1 minute'
      WHERE id=${reservation.id}
    `);
    const cleanup = await storage.cleanupExpiredReservations();
    expect(cleanup).toEqual({ cancelled: 1, unitsReleased: 1 });
    expect(await propertyInventory(sd118PropertyId)).toEqual({
      available_slots: 5,
      reserved_units: 0,
      sold_units: 0,
    });
    const account = await pglite.query<{ reserved_units: string; release_pending: boolean }>(`
      SELECT reserved_units::text,release_pending
      FROM investment_reservation_inventory WHERE reservation_id=${reservation.id}
    `);
    expect(account.rows[0]).toEqual({ reserved_units: "0.00", release_pending: false });
  });

  it("commits valid unrelated approval even when the SD118 legal workflow rejects a partial receipt", async () => {
    const { reservation, submissionId } = await createReservationAndPayment(sd118PropertyId, "500");
    const { approvePaymentSubmissionAtomically } = await import("../server/legal/approval");
    const approval = await approvePaymentSubmissionAtomically(submissionId, adminId);
    expect(approval.legal).toMatchObject({
      eligible: false,
      reason: "approved_submission_must_settle_full_NGN_purchase",
    });
    expect(await propertyInventory(sd118PropertyId)).toEqual({
      available_slots: 4,
      reserved_units: 0,
      sold_units: 1,
    });
    const state = await pglite.query<{ status: string }>(`
      SELECT status FROM investment_reservations WHERE id=${reservation.id}
    `);
    expect(state.rows[0].status).toBe("converted_to_investment");
  });
});