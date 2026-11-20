import fs from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    execute: vi.fn(),
    transaction: vi.fn(),
  },
}));

vi.mock("../server/db", () => ({ db: mocks.db }));

import {
  beginLegalNotificationAttempt,
  claimNextLegalJob,
  failLegalJob,
  recordLegalNotificationFailed,
  requestLegalNotificationResend,
} from "../server/legal/repository";
import { recordUnsignedLegalCancellation } from "../server/legal/holding-state";
import { claimExistingLegalNotification, getNotificationRecoveryStatus } from "../server/legal/notification-recovery";

let database: PGlite;
let baseMigration: string;
let cycleMigration: string;
let pairId: number;
let reservationId: number;
let jobId: number;
let cycleId: number;
let adminId: number;

function toExecutor(client: any) {
  return {
    execute: async (query: unknown) => {
      const compiled = new PgDialect().sqlToQuery(query as never);
      return client.query(compiled.sql, compiled.params as never[]);
    },
  };
}

function installDatabase(): void {
  mocks.db.execute.mockImplementation(async (query: unknown) => {
    const compiled = new PgDialect().sqlToQuery(query as never);
    return database.query(compiled.sql, compiled.params as never[]);
  });
  mocks.db.transaction.mockImplementation((callback: (tx: unknown) => unknown) =>
    database.transaction((tx) => callback(toExecutor(tx))),
  );
}

async function addPair(hasFrozenLandConsideration = true): Promise<number> {
  const reservation = await database.query<{ id: number }>(
    `INSERT INTO investment_reservations
       (user_id,property_id,status,funnel_stage)
     VALUES (1,1,'converted_to_investment','confirmed')
     RETURNING id`,
  );
  reservationId = reservation.rows[0].id;
  const pair = await database.query<{ id: number }>(`
    INSERT INTO legal_document_pairs (
      reservation_id, user_id, property_id, approval_source, approval_source_id,
      approved_by_admin_id, approved_at, effective_at, approval_note,
      full_name_snapshot, home_address_snapshot, property_area_sqm, units_snapshot,
      square_meters_per_unit, payment_amount_naira, payment_currency,
      data_snapshot, status, documents_ready_at, deed_template_id, transfer_template_id
    ) VALUES (
      ${reservation.rows[0].id}, 1, 1, 'admin_full_confirmation',
      ${reservation.rows[0].id}, ${adminId}, now(), now(), 'approved for testing',
      'Ada Lovelace', '1 Example Street', 5, 1, 5, 100000, 'NGN',
      '${hasFrozenLandConsideration ? '{"landConsiderationNaira":"100000"}' : '{}'}'::jsonb, 'documents_ready', now(), 1, 2
    )
    RETURNING id
  `);
  return pair.rows[0].id;
}

async function addNotificationJob(options: {
  cycleStatus: "queued" | "sending" | "sent" | "failed" | "uncertain" | "exhausted";
  jobStatus: "queued" | "retry" | "leased" | "complete" | "dead";
  attempts?: number;
  oldCycleUpdate?: boolean;
}): Promise<void> {
  const cycle = await database.query<{ id: number }>(`
    INSERT INTO legal_notification_cycles (
      pair_id, cycle_number, request_kind, status, attempt_count, created_at, updated_at
    ) VALUES (
      ${pairId}, 1, 'initial', '${options.cycleStatus}', 0,
      now() - interval '2 minutes',
      ${options.oldCycleUpdate ? "now() - interval '2 minutes'" : "now()"}
    )
    RETURNING id
  `);
  cycleId = cycle.rows[0].id;
  const isLeased = options.jobStatus === "leased";
  const job = await database.query<{ id: number }>(`
    INSERT INTO legal_jobs (
      pair_id, kind, status, attempts, notification_cycle_id,
      lease_token, leased_until, completed_at
    ) VALUES (
      ${pairId}, 'notify', '${options.jobStatus}', ${options.attempts ?? (isLeased ? 1 : 0)},
      ${cycleId}, ${isLeased ? "'initial-lease'" : "NULL"},
      ${isLeased ? "now() + interval '5 minutes'" : "NULL"},
      ${options.jobStatus === "complete" ? "now()" : "NULL"}
    )
    RETURNING id
  `);
  jobId = job.rows[0].id;
}

async function requestResend() {
  return database.transaction((tx) =>
    requestLegalNotificationResend(toExecutor(tx) as never, pairId, adminId),
  );
}

async function cancelHolding() {
  await database.transaction(async (tx) => {
    const executor = toExecutor(tx);
    await recordUnsignedLegalCancellation(executor as never, reservationId, adminId);
    await executor.execute(sql`
      UPDATE investment_reservations
      SET status='cancelled',funnel_stage=NULL
      WHERE id=${reservationId}
    `);
  });
}

beforeEach(async () => {
  database = new PGlite();
  baseMigration = await fs.readFile("scripts/ensure-legal-documents.sql", "utf8");
  cycleMigration = await fs.readFile("scripts/ensure-legal-notification-cycles.sql", "utf8");
  await database.exec(`
    CREATE TABLE admin_users (id serial PRIMARY KEY);
    CREATE TABLE users (id serial PRIMARY KEY);
    CREATE TABLE properties (id serial PRIMARY KEY);
    CREATE TABLE investment_reservations (
      id serial PRIMARY KEY,
      user_id integer,
      property_id integer,
      status text NOT NULL DEFAULT 'reserved',
      funnel_stage text
    );
    CREATE TABLE payment_submissions (id serial PRIMARY KEY);
    INSERT INTO admin_users DEFAULT VALUES;
    INSERT INTO users DEFAULT VALUES;
    INSERT INTO properties DEFAULT VALUES;
  `);
  adminId = 1;
  await database.exec(baseMigration);
  await database.exec(cycleMigration);
  await database.exec(await fs.readFile("scripts/ensure-legal-pdf-review.sql", "utf8"));
  installDatabase();
  await database.exec(`INSERT INTO legal_templates(document_type,version,original_filename,storage_key,sha256,byte_size,validation_status,created_by_admin_id)
    VALUES ('deed_of_assignment',1,'d.docx','legal/templates/deed/v1',repeat('a',64),10,'valid',1),
      ('transfer_exit_rights',1,'t.docx','legal/templates/transfer/v1',repeat('b',64),10,'valid',1);`);
  pairId = await addPair();
  await database.exec(`INSERT INTO legal_documents(pair_id,document_type,template_id,status,unsigned_pdf_key,unsigned_pdf_sha256,signature_placement)
    VALUES (${pairId},'deed_of_assignment',1,'awaiting_signature','legal/documents/test/unsigned_pdf',repeat('a',64),'{}'),
      (${pairId},'transfer_exit_rights',2,'awaiting_signature','legal/documents/test2/unsigned_pdf',repeat('b',64),'{}');`);
  await database.exec(`INSERT INTO legal_pdf_review_approvals(pair_id,approved_by_admin_id,deed_document_id,deed_sha256,transfer_document_id,transfer_sha256)
    SELECT ${pairId},1,d.id,d.unsigned_pdf_sha256,t.id,t.unsigned_pdf_sha256 FROM legal_documents d
    JOIN legal_documents t ON t.pair_id=d.pair_id WHERE d.pair_id=${pairId}
      AND d.document_type='deed_of_assignment' AND t.document_type='transfer_exit_rights';`);
});

afterEach(async () => {
  await database?.close();
});

describe("durable legal notification cycles (isolated PGlite)", () => {
  const recoveryInput = () => ({ pairId, propertyId: 1, jobId, cycleId, adminId });

  it("reports missing historical consideration without consuming a retry or changing reviewed PDFs", async () => {
    pairId = await addPair(false);
    await database.exec(`INSERT INTO legal_documents(pair_id,document_type,template_id,status,unsigned_pdf_key,unsigned_pdf_sha256,signature_placement)
      VALUES (${pairId},'deed_of_assignment',1,'awaiting_signature','legal/documents/historical-deed/unsigned_pdf',repeat('a',64),'{}'),
        (${pairId},'transfer_exit_rights',2,'awaiting_signature','legal/documents/historical-transfer/unsigned_pdf',repeat('b',64),'{}');
      INSERT INTO legal_pdf_review_approvals(pair_id,approved_by_admin_id,deed_document_id,deed_sha256,transfer_document_id,transfer_sha256)
      SELECT ${pairId},${adminId},d.id,d.unsigned_pdf_sha256,t.id,t.unsigned_pdf_sha256 FROM legal_documents d
      JOIN legal_documents t ON t.pair_id=d.pair_id AND t.document_type='transfer_exit_rights'
      WHERE d.pair_id=${pairId} AND d.document_type='deed_of_assignment';`);
    await addNotificationJob({ cycleStatus: "queued", jobStatus: "retry", attempts: 3 });
    const before = (await database.query(`SELECT row_to_json(d) AS document FROM legal_documents d WHERE pair_id=${pairId} ORDER BY id`)).rows;
    expect(await claimExistingLegalNotification(recoveryInput())).toMatchObject({
      state: "blocked", message: expect.stringContaining("historical purchase costs"),
    });
    expect((await database.query(`SELECT status,attempts FROM legal_jobs WHERE id=${jobId}`)).rows[0]).toEqual({ status: "retry", attempts: 3 });
    expect((await database.query(`SELECT row_to_json(d) AS document FROM legal_documents d WHERE pair_id=${pairId} ORDER BY id`)).rows).toEqual(before);
  });

  it("recovers only the selected eligible notification, preserving its cycle and evidence", async () => {
    await addNotificationJob({ cycleStatus: "queued", jobStatus: "retry", attempts: 3 });
    const before = (await database.query(`SELECT row_to_json(d) AS document FROM legal_documents d ORDER BY id`)).rows;
    const otherPair = await addPair();
    await database.exec(`INSERT INTO legal_jobs(pair_id,kind,status) VALUES (${otherPair},'generation','queued')`);
    const recovered = await claimExistingLegalNotification(recoveryInput());
    expect(recovered).toMatchObject({ state: "claimed", claim: { id: jobId, pairId, kind: "notify", notificationCycleId: cycleId, attempts: 4 } });
    expect((await database.query(`SELECT status,attempts FROM legal_jobs WHERE pair_id=${otherPair}`)).rows[0]).toEqual({ status: "queued", attempts: 0 });
    expect((await database.query(`SELECT count(*)::int AS n FROM legal_notification_cycles WHERE pair_id=${pairId}`)).rows[0]).toEqual({ n: 1 });
    expect((await database.query(`SELECT row_to_json(d) AS document FROM legal_documents d ORDER BY id`)).rows).toEqual(before);
    expect((await database.query(`SELECT event_type FROM legal_audit_events WHERE event_type='notification_bounded_recovery_requested'`)).rows).toHaveLength(1);
    expect(await claimExistingLegalNotification(recoveryInput())).toMatchObject({ state: "in_progress" });
  });

  it("reports retry eligibility without changing backoff or attempts", async () => {
    await addNotificationJob({ cycleStatus: "queued", jobStatus: "retry", attempts: 3 });
    await database.exec(`UPDATE legal_jobs SET available_at=now()+interval '4 minutes',last_error='APP_BASE_URL must be configured as an HTTPS application origin' WHERE id=${jobId}`);
    const before = (await database.query(`SELECT status,attempts,available_at FROM legal_jobs WHERE id=${jobId}`)).rows;
    expect(await claimExistingLegalNotification(recoveryInput())).toMatchObject({
      state: "waiting_retry", availableAt: expect.any(String), message: expect.stringContaining("APP_BASE_URL"),
    });
    expect((await database.query(`SELECT status,attempts,available_at FROM legal_jobs WHERE id=${jobId}`)).rows).toEqual(before);
    expect((await database.query(`SELECT count(*)::int AS n FROM legal_audit_events WHERE event_type='notification_bounded_recovery_requested'`)).rows[0]).toEqual({ n: 0 });
  });

  it("coalesces competing recovery claims without another lease or cycle", async () => {
    await addNotificationJob({ cycleStatus: "queued", jobStatus: "retry" });
    const results = await Promise.all([
      claimExistingLegalNotification(recoveryInput()), claimExistingLegalNotification(recoveryInput()),
    ]);
    expect(results.map(result => result.state).sort()).toEqual(["claimed", "in_progress"]);
    expect((await database.query(`SELECT attempts FROM legal_jobs WHERE id=${jobId}`)).rows[0]).toEqual({ attempts: 1 });
    expect((await database.query(`SELECT count(*)::int AS n FROM legal_notification_cycles WHERE pair_id=${pairId}`)).rows[0]).toEqual({ n: 1 });
  });

  it("does not claim recovery after both signatures are recorded", async () => {
    await addNotificationJob({ cycleStatus: "queued", jobStatus: "retry" });
    await database.exec(`UPDATE legal_documents SET status='investor_signed',investor_signed_at=now() WHERE pair_id=${pairId}`);
    await expect(claimExistingLegalNotification(recoveryInput())).rejects.toThrow("outstanding investor signature");
    expect((await database.query(`SELECT status,attempts FROM legal_jobs WHERE id=${jobId}`)).rows[0]).toEqual({ status: "retry", attempts: 0 });
  });

  it.each([
    ["sent", "complete", "accepted"],
    ["sending", "leased", "blocked_uncertain"],
    ["uncertain", "dead", "blocked_uncertain"],
    ["exhausted", "dead", "blocked"],
    ["queued", "leased", "in_progress"],
    ["queued", "dead", "blocked"],
  ] as const)("does not reclaim or resend %s/%s work", async (cycleStatus, jobStatus, state) => {
    await addNotificationJob({ cycleStatus, jobStatus });
    if (jobStatus === "leased") await database.exec(`UPDATE legal_jobs SET leased_until=now()-interval '1 minute' WHERE id=${jobId}`);
    const before = (await database.query(`SELECT row_to_json(j) AS job FROM legal_jobs j WHERE id=${jobId}`)).rows;
    expect(await claimExistingLegalNotification(recoveryInput())).toMatchObject({ state });
    expect((await database.query(`SELECT row_to_json(j) AS job FROM legal_jobs j WHERE id=${jobId}`)).rows).toEqual(before);
  });

  it("rejects stale cycles, other properties, inactive holdings and missing exact PDF approval", async () => {
    await addNotificationJob({ cycleStatus: "queued", jobStatus: "retry" });
    await expect(claimExistingLegalNotification({ ...recoveryInput(), cycleId: cycleId + 100 })).rejects.toThrow("no longer matches");
    await expect(claimExistingLegalNotification({ ...recoveryInput(), propertyId: 999 })).rejects.toThrow("not found");
    await expect(claimExistingLegalNotification({ ...recoveryInput(), jobId: 0 })).rejects.toThrow("IDs are required");
    // Append-only approval evidence is never deleted. Use a fresh, unreviewed pair.
    const approvedInput = recoveryInput();
    pairId = await addPair();
    await database.exec(`INSERT INTO legal_documents(pair_id,document_type,template_id,status,unsigned_pdf_key,unsigned_pdf_sha256,signature_placement)
      VALUES (${pairId},'deed_of_assignment',1,'awaiting_signature','legal/documents/new/unsigned_pdf',repeat('a',64),'{}'),
        (${pairId},'transfer_exit_rights',2,'awaiting_signature','legal/documents/new2/unsigned_pdf',repeat('b',64),'{}');`);
    await addNotificationJob({ cycleStatus: "queued", jobStatus: "retry" });
    await expect(claimExistingLegalNotification(recoveryInput())).rejects.toThrow("Administrator review");
    await cancelHolding();
    await expect(claimExistingLegalNotification(recoveryInput())).rejects.toThrow("confirmed");
    expect(await getNotificationRecoveryStatus(approvedInput)).toMatchObject({ state: "retry" });
  });

  it("fences pre-existing unsent work without fabricating approval or sending intent", async () => {
    pairId = await addPair();
    await database.exec(`INSERT INTO legal_documents(pair_id,document_type,template_id,status,unsigned_pdf_key,unsigned_pdf_sha256,signature_placement)
      VALUES (${pairId},'deed_of_assignment',1,'awaiting_signature','legal/documents/test/unsigned_pdf',repeat('a',64),'{}'),
        (${pairId},'transfer_exit_rights',2,'awaiting_signature','legal/documents/test2/unsigned_pdf',repeat('b',64),'{}');`);
    await addNotificationJob({ cycleStatus: "queued", jobStatus: "leased" });
    expect(await beginLegalNotificationAttempt(jobId, "initial-lease")).toEqual({ state: "review_required" });
    expect((await database.query(`SELECT status FROM legal_jobs WHERE id=${jobId}`)).rows[0]).toEqual({ status: "blocked" });
    await expect(requestResend()).rejects.toThrow("Administrator review");
    expect((await database.query(`SELECT count(*)::int AS n FROM legal_audit_events
      WHERE pair_id=${pairId} AND event_type='legal_documents_ready_email_attempt_started'`)).rows[0]).toEqual({ n: 0 });
    await database.exec(`INSERT INTO legal_pdf_review_approvals(pair_id,approved_by_admin_id,deed_document_id,deed_sha256,transfer_document_id,transfer_sha256)
      SELECT ${pairId},1,d.id,d.unsigned_pdf_sha256,t.id,t.unsigned_pdf_sha256 FROM legal_documents d
      JOIN legal_documents t ON t.pair_id=d.pair_id WHERE d.pair_id=${pairId}
        AND d.document_type='deed_of_assignment' AND t.document_type='transfer_exit_rights';`);
    expect(await requestResend()).toMatchObject({ state: "queued", cycleId });
    const claim = await claimNextLegalJob();
    expect(await beginLegalNotificationAttempt(claim!.id, claim!.leaseToken)).toEqual({ state: "send", attempt: 1 });
  });

  it("creates one new cycle after a successful delivery and coalesces concurrent admin requests", async () => {
    await addNotificationJob({
      cycleStatus: "sent",
      jobStatus: "complete",
      oldCycleUpdate: true,
    });

    const outcomes = await Promise.all([requestResend(), requestResend()]);

    expect(outcomes.every((outcome) => outcome.state === "queued" && outcome.queued)).toBe(true);
    expect(new Set(outcomes.map((outcome) => outcome.cycleId)).size).toBe(1);
    expect(outcomes.filter((outcome) => !outcome.coalesced)).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.coalesced)).toHaveLength(1);

    const cycles = await database.query<{ count: number }>(`
      SELECT count(*)::int AS count FROM legal_notification_cycles WHERE pair_id = ${pairId}
    `);
    expect(cycles.rows[0].count).toBe(2);
    const resendAudits = await database.query<{ count: number }>(`
      SELECT count(*)::int AS count FROM legal_audit_events
      WHERE pair_id = ${pairId} AND event_type = 'notification_resend_requested'
    `);
    expect(resendAudits.rows[0].count).toBe(1);

    const claim = await claimNextLegalJob();
    expect(claim).toMatchObject({
      id: jobId,
      kind: "notify",
      notificationCycleId: outcomes[0].cycleId,
    });
  });

  it("fences a queued notification and refuses to start SMTP work after unsigned cancellation", async () => {
    await addNotificationJob({ cycleStatus: "queued", jobStatus: "queued" });
    await cancelHolding();

    const job = await database.query<{ status: string; lease_token: string | null }>(`
      SELECT status,lease_token FROM legal_jobs WHERE id=${jobId}
    `);
    expect(job.rows[0]).toEqual({ status: "blocked", lease_token: null });
    await expect(beginLegalNotificationAttempt(jobId, "initial-lease"))
      .rejects.toThrow(/not currently confirmed and active/i);
    const cycle = await database.query<{ status: string }>(`
      SELECT status FROM legal_notification_cycles WHERE id=${cycleId}
    `);
    expect(cycle.rows[0].status).toBe("queued");
    const starts = await database.query<{ count: number }>(`
      SELECT count(*)::int AS count FROM legal_audit_events
      WHERE pair_id=${pairId} AND event_type='legal_documents_ready_email_attempt_started'
    `);
    expect(starts.rows[0].count).toBe(0);
  });

  it("retains false-send attempts in one cycle, exhausts it, then allows an explicit resend", async () => {
    await addNotificationJob({ cycleStatus: "queued", jobStatus: "leased" });
    let leaseToken = "initial-lease";

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const start = await beginLegalNotificationAttempt(jobId, leaseToken);
      expect(start).toEqual({ state: "send", attempt });
      await recordLegalNotificationFailed(
        jobId,
        leaseToken,
        attempt,
        "sendEmail returned false",
      );
      await failLegalJob(jobId, leaseToken, "Legal documents are ready, but investor notification failed");

      if (attempt < 3) {
        await database.query(`UPDATE legal_jobs SET available_at = now() WHERE id = ${jobId}`);
        const claim = await claimNextLegalJob();
        expect(claim?.notificationCycleId).toBe(cycleId);
        leaseToken = claim!.leaseToken;
      }
    }

    await database.query(`UPDATE legal_jobs SET available_at = now() WHERE id = ${jobId}`);
    const finalClaim = await claimNextLegalJob();
    expect(finalClaim?.notificationCycleId).toBe(cycleId);
    const exhausted = await beginLegalNotificationAttempt(jobId, finalClaim!.leaseToken);
    expect(exhausted).toEqual({ state: "exhausted" });

    const history = await database.query<{ starts: number; failures: number }>(`
      SELECT
        count(*) FILTER (WHERE event_type = 'legal_documents_ready_email_attempt_started')::int AS starts,
        count(*) FILTER (WHERE event_type = 'legal_documents_ready_email_failed')::int AS failures
      FROM legal_audit_events
      WHERE pair_id = ${pairId} AND details->>'notificationCycleId' = '${cycleId}'
    `);
    expect(history.rows[0]).toEqual({ starts: 3, failures: 3 });

    await database.query(`
      UPDATE legal_notification_cycles
      SET updated_at = now() - interval '2 minutes'
      WHERE id = ${cycleId}
    `);
    const resend = await requestResend();
    expect(resend).toMatchObject({
      state: "queued",
      queued: true,
      coalesced: false,
      cycleNumber: 2,
    });
    const queuedClaim = await claimNextLegalJob();
    expect(queuedClaim?.notificationCycleId).toBe(resend.cycleId);
  });

  it("keeps unresolved SMTP intent ambiguous and blocks an admin resend", async () => {
    await addNotificationJob({ cycleStatus: "queued", jobStatus: "leased" });
    const started = await beginLegalNotificationAttempt(jobId, "initial-lease");
    expect(started).toEqual({ state: "send", attempt: 1 });

    await failLegalJob(jobId, "initial-lease", "worker lost an unconfirmed SMTP result");
    const cycle = await database.query<{ status: string }>(`
      SELECT status FROM legal_notification_cycles WHERE id = ${cycleId}
    `);
    expect(cycle.rows[0].status).toBe("uncertain");

    const resend = await requestResend();
    expect(resend.state).toBe("blocked_uncertain");
    expect(resend.queued).toBe(false);
    const cycleCount = await database.query<{ count: number }>(`
      SELECT count(*)::int AS count FROM legal_notification_cycles WHERE pair_id = ${pairId}
    `);
    expect(cycleCount.rows[0].count).toBe(1);
  });

  it("backfills a successful legacy job without rewriting its append-only send history", async () => {
    const priorJob = await database.query<{ id: number }>(`
      INSERT INTO legal_jobs (pair_id, kind, status)
      VALUES (${pairId}, 'notify', 'complete')
      RETURNING id
    `);
    await database.query(
      `INSERT INTO legal_audit_events (pair_id, actor_type, event_type, details)
       VALUES ($1, 'worker', 'legal_documents_ready_email_sent', $2::jsonb)`,
      [pairId, JSON.stringify({ jobId: priorJob.rows[0].id, attempt: 1 })],
    );
    const before = await database.query<{ count: number }>(`
      SELECT count(*)::int AS count FROM legal_audit_events WHERE pair_id = ${pairId}
    `);

    // Re-running the additive migration maps only jobs which predate cycle IDs.
    await database.exec(cycleMigration);

    const activeCycle = await database.query<{ status: string; cycleNumber: number }>(`
      SELECT c.status, c.cycle_number AS "cycleNumber"
      FROM legal_jobs j
      JOIN legal_notification_cycles c ON c.id = j.notification_cycle_id
      WHERE j.id = ${priorJob.rows[0].id}
    `);
    const after = await database.query<{ count: number }>(`
      SELECT count(*)::int AS count FROM legal_audit_events WHERE pair_id = ${pairId}
    `);
    expect(activeCycle.rows[0]).toEqual({ status: "sent", cycleNumber: 1 });
    expect(after.rows[0].count).toBe(before.rows[0].count);
  });
});