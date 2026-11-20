import { createHash } from "node:crypto";

// Small query interface supports both a dedicated PostgreSQL transaction client
// and disposable PGlite tests. This module never opens a database connection.
export interface ConsolidationClient {
  query(sql: string, params?: any[]): Promise<{ rows: any[]; rowCount?: number | null }>;
}
export class ConsolidationError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
const identityFields = ["id", "email", "first_name", "last_name", "kyc_status", "kyc_full_name",
  "kyc_date_of_birth", "kyc_id_type", "kyc_id_number", "email_verified", "is_active"];
const camel = (key: string) => key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
function identity(row: any) {
  return Object.fromEntries(identityFields.map(key => [camel(key), key === "kyc_id_number"
    ? (row[key] ? `••••${String(row[key]).slice(-4)}` : null) : row[key]]));
}
function identityBlockers(source: any, destination: any) {
  const blockers: string[] = [];
  for (const account of [source, destination]) {
    if (!["user", "investor"].includes(account.role) || account.parent_developer_id) blockers.push("Only standalone investor accounts are supported.");
    if (!account.is_active || account.account_status !== "approved") blockers.push("Both accounts must be active approved members.");
    if (!account.email_verified) blockers.push("Both account email addresses must be verified.");
    if (account.kyc_status !== "approved") blockers.push("Both accounts require approved KYC before consolidation.");
  }
  // Deliberately strict: formatting differences require separate KYC review,
  // never an administrator override or name-based similarity heuristic.
  for (const key of ["kyc_full_name", "kyc_date_of_birth", "kyc_id_type", "kyc_id_number"]) {
    const a = source[key], b = destination[key];
    if (!a || !b || String(a) !== String(b)) blockers.push(`Verified identity conflict: ${key.replaceAll("_", " ")}.`);
  }
  return blockers;
}

// Include both actual FK dependencies and conventionally linked legacy/legal
// columns (legal history deliberately has several links without foreign keys).
async function dependencies(client: ConsolidationClient) {
  return (await client.query(`
    SELECT DISTINCT c.table_name, c.column_name,
      (SELECT u.table_name FROM information_schema.key_column_usage k
        JOIN information_schema.referential_constraints r
          ON r.constraint_schema = k.constraint_schema AND r.constraint_name = k.constraint_name
        JOIN information_schema.constraint_column_usage u
          ON u.constraint_schema = r.unique_constraint_schema AND u.constraint_name = r.unique_constraint_name
        WHERE k.table_schema = c.table_schema AND k.table_name = c.table_name
          AND k.column_name = c.column_name AND u.table_name IN ('users','investment_reservations')
        LIMIT 1) AS referenced_table
    FROM information_schema.columns c
    JOIN information_schema.tables t USING (table_schema, table_name)
    WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
      AND c.data_type IN ('integer', 'bigint', 'smallint')
      AND (
        c.column_name ~ '(^|_)(user|investor|seller|buyer|bidder|winner|developer|contractor|lister|reservation)_id$'
        OR EXISTS (
          SELECT 1 FROM information_schema.key_column_usage k
          JOIN information_schema.referential_constraints r
            ON r.constraint_schema = k.constraint_schema AND r.constraint_name = k.constraint_name
          JOIN information_schema.constraint_column_usage u
            ON u.constraint_schema = r.unique_constraint_schema AND u.constraint_name = r.unique_constraint_name
          WHERE k.table_schema = c.table_schema AND k.table_name = c.table_name
            AND k.column_name = c.column_name AND u.table_name IN ('users', 'investment_reservations')
        )
      )
    ORDER BY c.table_name, c.column_name
  `)).rows;
}
export async function previewConsolidation(client: ConsolidationClient, sourceId: number, destinationId: number, lock = false) {
  if (sourceId === destinationId) throw new ConsolidationError(400, "Choose two different accounts.");
  const deps = await dependencies(client);
  if (lock) {
    // Coordinate with existing writers that do not know about consolidation.
    // Short table locks prevent new resale/legal/payment dependencies arriving
    // between the fail-closed inspection and the owner update.
    const tables = Array.from(new Set<string>(["users", "investment_reservations", "ownership_certificates",
      "account_consolidations", ...deps.map(d => d.table_name)])).sort();
    await client.query(`LOCK TABLE ${tables.map(quote).join(", ")} IN SHARE ROW EXCLUSIVE MODE`);
  }
  const accounts = (await client.query("SELECT * FROM users WHERE id IN ($1,$2) ORDER BY id", [sourceId, destinationId])).rows;
  const source = accounts.find(a => a.id === sourceId), destination = accounts.find(a => a.id === destinationId);
  if (!source || !destination) throw new ConsolidationError(404, "Account not found.");
  const holdings = (await client.query("SELECT * FROM investment_reservations WHERE user_id IN ($1,$2) ORDER BY id", [sourceId, destinationId])).rows;
  const ids = holdings.map(h => h.id);
  const certificates = (await client.query("SELECT * FROM ownership_certificates WHERE reservation_id = ANY($1::int[]) ORDER BY id", [ids])).rows;
  const blockers = identityBlockers(source, destination);
  const moving = holdings.filter(h => h.user_id === sourceId);
  if (!moving.length) blockers.push("The source has no holdings to move.");
  if (moving.some(h => h.status !== "converted_to_investment")) blockers.push("All source holdings must be confirmed investments.");
  const counts: any[] = [];
  for (const dep of deps) {
    const { table_name: table, column_name: column } = dep;
    if (["investment_reservations", "ownership_certificates", "account_consolidations"].includes(table)) continue;
    if (table === "payment_submissions" && column === "user_id") continue;
    const reservationLink = dep.referenced_table === "investment_reservations" ||
      column === "reservation_id" || column.endsWith("_reservation_id");
    // Never migrate historical payment evidence or inventory allocations.
    if (reservationLink && ["investment_payments", "payment_submissions", "investment_reservation_inventory"].includes(table)) continue;
    const protectedWork = /legal|resale/.test(table);
    const targets = reservationLink ? (protectedWork ? ids : moving.map(h => h.id)) : (protectedWork ? [sourceId, destinationId] : [sourceId]);
    const count = (await client.query(`SELECT count(*)::int AS count FROM ${quote(table)} WHERE ${quote(column)} = ANY($1::int[])`, [targets])).rows[0].count;
    if (count) {
      counts.push({ table, column, count });
      blockers.push(`Unsupported dependency: ${table}.${column} (${count}). Legal/resale history and other linked work cannot be reassigned.`);
    }
  }
  // Payment submissions stay with the original payer as historical evidence.
  // Pending submissions, however, may still mutate the investment.
  const paymentTable = deps.some(d => d.table_name === "payment_submissions");
  if (paymentTable) {
    const pending = (await client.query("SELECT count(*)::int AS count FROM payment_submissions WHERE reservation_id = ANY($1::int[]) AND status NOT IN ('approved','rejected')", [moving.map(h => h.id)])).rows[0].count;
    if (pending) blockers.push("Source holdings have unresolved payment submissions.");
  }
  const prior = (await client.query("SELECT id FROM account_consolidations WHERE source_id IN ($1,$2) OR destination_id = $1", [sourceId, destinationId])).rows;
  if (prior.length) blockers.push("An account already participates in a consolidation chain.");
  return {
    source: identity(source), destination: identity(destination), holdings, certificates,
    blockers: Array.from(new Set(blockers)),
    previewToken: hash({ source, destination, holdings, certificates, counts, prior }),
  };
}

export interface ConsolidationInput {
  sourceId: number; destinationId: number; previewToken: string; requestId: string;
  identityVerified: true; verificationNote: string; confirmation: string; updateContactEmail: boolean;
}
export async function executeConsolidation(client: ConsolidationClient, input: ConsolidationInput, adminId: number) {
  const requestHash = hash({ ...input, adminId });
  await client.query("BEGIN");
  try {
    // Same lock order as preview; global transaction lock serializes requests.
    await client.query("LOCK TABLE account_consolidations IN SHARE ROW EXCLUSIVE MODE");
    const previous = (await client.query("SELECT * FROM account_consolidations WHERE request_id = $1", [input.requestId])).rows[0];
    if (previous) {
      if (previous.request_hash !== requestHash) throw new ConsolidationError(409, "Request reference was already used with different instructions.");
      await client.query("COMMIT");
      return { auditId: previous.id, sourceId: previous.source_id, destinationId: previous.destination_id, holdingIds: previous.evidence.holdingIds };
    }
    if (input.identityVerified !== true || input.verificationNote.trim().length < 20 ||
        input.verificationNote.length > 1000 ||
        input.confirmation !== `CONSOLIDATE ${input.sourceId} INTO ${input.destinationId}`) {
      throw new ConsolidationError(400, "Explicit identity verification, evidence reference and exact confirmation are required.");
    }
    const preview = await previewConsolidation(client, input.sourceId, input.destinationId, true);
    if (preview.blockers.length) throw new ConsolidationError(409, preview.blockers.join(" ").slice(0, 500));
    if (preview.previewToken !== input.previewToken) throw new ConsolidationError(409, "Account data changed. Preview again before confirming.");
    const moving = preview.holdings.filter(h => h.user_id === input.sourceId);
    const holdingIds = moving.map(h => h.id);
    await client.query(`UPDATE investment_reservations SET user_id = $1,
      email = CASE WHEN $2 THEN $3 ELSE email END WHERE id = ANY($4::int[])`,
    [input.destinationId, input.updateContactEmail, preview.destination.email, holdingIds]);
    // Retain source identity, KYC and contact details; revoke login/reset access.
    await client.query("UPDATE users SET is_active = false, reset_token = NULL, reset_token_expiry = NULL WHERE id = $1", [input.sourceId]);
    const audit = (await client.query(`INSERT INTO account_consolidations
      (request_id,admin_id,source_id,destination_id,request_hash,verification_note,evidence)
      VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb) RETURNING id`,
    [input.requestId, adminId, input.sourceId, input.destinationId, requestHash, input.verificationNote.trim(),
      JSON.stringify({ holdingIds, source: preview.source, destination: preview.destination,
        holdingsBefore: moving, certificates: preview.certificates, updateContactEmail: input.updateContactEmail,
        previewToken: preview.previewToken, identityVerification: "exact-approved-kyc-id-type-number-full-name-date-of-birth" })])).rows[0];
    await client.query("COMMIT");
    return { auditId: audit.id, sourceId: input.sourceId, destinationId: input.destinationId, holdingIds };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
