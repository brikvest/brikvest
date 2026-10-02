import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../scripts/ensure-legal-template-deletion.sql", import.meta.url),
  "utf8",
);
const databaseName = "postgres";
const databaseUser = "legal_test";
const socketPort = "55439";

let rootDirectory: string | undefined;
let socketDirectory: string | undefined;
let pgCtl: string;
let psql: string;
let childEnvironment: NodeJS.ProcessEnv;
let markerSequence = 0;
let testSequence = 0;

function resolveBinary(name: string): string {
  return execFileSync("which", [name], { encoding: "utf8" }).trim();
}

function isolatedEnvironment(applicationName?: string): NodeJS.ProcessEnv {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !key.startsWith("PG") &&
        key !== "DATABASE_URL" &&
        key !== "TEST_DATABASE_URL",
    ),
  );
  if (applicationName) env.PGAPPNAME = applicationName;
  return env;
}

function connectionArgs(): string[] {
  return [
    "-X",
    "-h",
    socketDirectory!,
    "-p",
    socketPort,
    "-U",
    databaseUser,
    "-d",
    databaseName,
  ];
}

function runSql(sql: string): string {
  return execFileSync(
    psql,
    [...connectionArgs(), "-v", "ON_ERROR_STOP=1", "-q", "-A", "-t", "-c", sql],
    {
      encoding: "utf8",
      env: isolatedEnvironment(),
      timeout: 15_000,
    },
  );
}

function launchSql(applicationName: string, sql: string) {
  const child = spawn(
    psql,
    [...connectionArgs(), "-v", "ON_ERROR_STOP=1", "-q", "-c", sql],
    { env: isolatedEnvironment(applicationName), stdio: ["ignore", "pipe", "pipe"] },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
  const done = new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code) => resolve({ code, stdout, stderr }));
    },
  );
  return { child, done };
}

function openSession(applicationName: string): InteractiveSession {
  const child = spawn(psql, [...connectionArgs(), "-v", "ON_ERROR_STOP=1", "-q"], {
    env: isolatedEnvironment(applicationName),
    stdio: ["pipe", "pipe", "pipe"],
  });
  return new InteractiveSession(child);
}

class InteractiveSession {
  private output = "";
  private errorOutput = "";
  private readonly waiters: Array<{
    marker: string;
    resolve: () => void;
    reject: (error: Error) => void;
  }> = [];
  private readonly closed: Promise<void>;

  constructor(private readonly child: ChildProcess) {
    child.stdout?.setEncoding("utf8").on("data", (chunk: string) => {
      this.output += chunk;
      this.resolveMarkers();
    });
    child.stderr?.setEncoding("utf8").on("data", (chunk: string) => {
      this.errorOutput += chunk;
    });
    this.closed = new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`psql session exited with ${code}: ${this.errorOutput}`));
        for (const waiter of this.waiters.splice(0)) {
          waiter.reject(new Error(`psql session closed before its command completed: ${this.errorOutput}`));
        }
      });
    });
  }

  async run(sql: string): Promise<void> {
    const marker = `__LEGAL_SQL_READY_${++markerSequence}__`;
    const reached = new Promise<void>((resolve, reject) => {
      this.waiters.push({ marker, resolve, reject });
    });
    this.child.stdin!.write(`${sql}\n\\echo ${marker}\n`);
    await Promise.race([
      reached,
      this.closed.then(() => {
        throw new Error("psql session closed unexpectedly");
      }),
    ]);
  }

  async close(): Promise<void> {
    if (!this.child.killed && this.child.exitCode === null) {
      this.child.stdin!.write("ROLLBACK;\n\\q\n");
    }
    await this.closed;
  }

  private resolveMarkers(): void {
    for (let index = this.waiters.length - 1; index >= 0; index--) {
      const waiter = this.waiters[index];
      if (this.output.includes(waiter.marker)) {
        this.waiters.splice(index, 1);
        waiter.resolve();
      }
    }
  }
}

async function waitUntilSessionIsLockBlocked(applicationName: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  let lastActivity = "";
  while (Date.now() < deadline) {
    const result = runSql(`
      SELECT wait_event_type, wait_event, state, left(query, 100)
      FROM pg_stat_activity
        WHERE application_name = '${applicationName}'
      ORDER BY pid
    `);
    lastActivity = result.trim();
    if (lastActivity.startsWith("Lock|")) return;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error(
    `PostgreSQL session ${applicationName} never entered a lock wait; last activity: ${lastActivity || "(no session)"}`,
  );
}

async function createTemplate(isActive = false): Promise<number> {
  const id = 1000 + ++testSequence;
  runSql(`
    INSERT INTO legal_templates(
      id, property_id, document_type, version, is_active, activated_at, storage_key, sha256
    ) VALUES (
      ${id}, 10, 'deed_of_assignment', ${id}, ${isActive},
      ${isActive ? "now()" : "NULL"}, 'legal/${id}', 'sha-${id}'
    )
  `);
  return id;
}

type ReferenceKind = "pair" | "document";

function addReferenceSql(kind: ReferenceKind, referenceId: number, templateId: number): string {
  return kind === "pair"
    ? `INSERT INTO legal_document_pairs(id, deed_template_id) VALUES (${referenceId}, ${templateId})`
    : `INSERT INTO legal_documents(id, template_id) VALUES (${referenceId}, ${templateId})`;
}

async function referenceWinsDeletion(kind: ReferenceKind): Promise<void> {
  const templateId = await createTemplate();
  const referenceId = templateId + 10_000;
  const pinName = `pin_first_${templateId}`;
  const deletionName = `delete_after_pin_${templateId}`;
  const pin = openSession(pinName);
  try {
    await pin.run(`BEGIN; ${addReferenceSql(kind, referenceId, templateId)};`);
    const deletion = launchSql(
      deletionName,
      `UPDATE legal_templates SET deleted_at = now(), deleted_by_admin_id = 7 WHERE id = ${templateId}`,
    );
    await waitUntilSessionIsLockBlocked(deletionName);
    await pin.run("COMMIT;");
    const result = await deletion.done;
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("Referenced legal template versions cannot be deleted");
  } finally {
    await pin.close();
  }
}

async function deletionWinsReference(kind: ReferenceKind): Promise<void> {
  const templateId = await createTemplate();
  const referenceId = templateId + 20_000;
  const deletionName = `delete_first_${templateId}`;
  const referenceName = `pin_after_delete_${templateId}`;
  const deletion = openSession(deletionName);
  try {
    await deletion.run(
      `BEGIN; UPDATE legal_templates SET deleted_at = now(), deleted_by_admin_id = 7 WHERE id = ${templateId};`,
    );
    const reference = launchSql(
      referenceName,
      addReferenceSql(kind, referenceId, templateId),
    );
    await waitUntilSessionIsLockBlocked(referenceName);
    await deletion.run("COMMIT;");
    const result = await reference.done;
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain(
      kind === "pair"
        ? "Deleted legal template versions cannot be newly pinned"
        : "Deleted legal template versions cannot be newly referenced",
    );
  } finally {
    await deletion.close();
  }
}

async function activationWinsDeletion(): Promise<void> {
  const templateId = await createTemplate();
  const activationName = `activate_first_${templateId}`;
  const deletionName = `delete_after_activation_${templateId}`;
  const activation = openSession(activationName);
  try {
    await activation.run(
      `BEGIN; UPDATE legal_templates SET is_active = true, activated_at = now() WHERE id = ${templateId};`,
    );
    const deletion = launchSql(
      deletionName,
      `UPDATE legal_templates SET deleted_at = now(), deleted_by_admin_id = 7 WHERE id = ${templateId}`,
    );
    await waitUntilSessionIsLockBlocked(deletionName);
    await activation.run("COMMIT;");
    const result = await deletion.done;
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("cannot be cleared or activated");
  } finally {
    await activation.close();
  }
}

async function deletionWinsActivation(): Promise<void> {
  const templateId = await createTemplate();
  const deletionName = `delete_first_activation_${templateId}`;
  const activationName = `activate_after_delete_${templateId}`;
  const deletion = openSession(deletionName);
  try {
    await deletion.run(
      `BEGIN; UPDATE legal_templates SET deleted_at = now(), deleted_by_admin_id = 7 WHERE id = ${templateId};`,
    );
    const activation = launchSql(
      activationName,
      `UPDATE legal_templates SET is_active = true, activated_at = now() WHERE id = ${templateId}`,
    );
    await waitUntilSessionIsLockBlocked(activationName);
    await deletion.run("COMMIT;");
    const result = await activation.done;
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("Deleted legal template versions are immutable");
  } finally {
    await deletion.close();
  }
}

describe("legal template deletion with isolated PostgreSQL concurrency", () => {
  beforeAll(() => {
    rootDirectory = mkdtempSync(path.join(tmpdir(), "legal-template-deletion-pg-"));
    socketDirectory = path.join(rootDirectory, "socket");
    const dataDirectory = path.join(rootDirectory, "data");
    const logFile = path.join(rootDirectory, "postgres.log");
    const initdb = resolveBinary("initdb");
    pgCtl = resolveBinary("pg_ctl");
    psql = resolveBinary("psql");
    childEnvironment = isolatedEnvironment();
    // The server's Unix socket is confined to this mode-0700 directory. TCP is
    // explicitly disabled, and no database URL or PostgreSQL env is inherited.
    mkdirSync(socketDirectory, { mode: 0o700 });
    chmodSync(rootDirectory, 0o700);
    execFileSync(initdb, ["-D", dataDirectory, "-U", databaseUser, "-A", "trust", "--no-locale"], {
      env: childEnvironment,
      stdio: "pipe",
    });
    execFileSync(
      pgCtl,
      [
        "-D",
        dataDirectory,
        "-l",
        logFile,
        "-o",
        `-c listen_addresses='' -c unix_socket_directories='${socketDirectory}' -c port=${socketPort} -c fsync=off`,
        "-w",
        "start",
      ],
      { env: childEnvironment, stdio: "pipe", timeout: 30_000 },
    );
    runSql(`
      CREATE TABLE admin_users(id integer PRIMARY KEY);
      INSERT INTO admin_users VALUES (7);
      CREATE TABLE legal_templates(
        id integer PRIMARY KEY, property_id integer, document_type text, version integer,
        is_active boolean NOT NULL DEFAULT false, activated_at timestamptz,
        storage_key text NOT NULL, sha256 text NOT NULL, created_by_admin_id integer
      );
      CREATE TABLE legal_document_pairs(
        id integer PRIMARY KEY, deed_template_id integer, transfer_template_id integer
      );
      CREATE TABLE legal_documents(id integer PRIMARY KEY, template_id integer NOT NULL);
    `);
    runSql(migration);
    runSql(migration);
  }, 60_000);

  afterAll(() => {
    if (!rootDirectory) return;
    if (pgCtl) {
      try {
        execFileSync(pgCtl, ["-D", path.join(rootDirectory, "data"), "-m", "immediate", "-w", "stop"], {
          env: childEnvironment,
          stdio: "pipe",
          timeout: 15_000,
        });
      } catch {
        // Remove the disposable cluster even if startup did not fully succeed.
      }
    }
    rmSync(rootDirectory, { recursive: true, force: true });
  }, 30_000);

  it("orders pair pinning before deletion and preserves the committed pin", async () => {
    await referenceWinsDeletion("pair");
  });

  it("orders deletion before pair pinning and rejects the late pin", async () => {
    await deletionWinsReference("pair");
  });

  it("orders document references before deletion and preserves the committed reference", async () => {
    await referenceWinsDeletion("document");
  });

  it("orders deletion before a document reference and rejects the late reference", async () => {
    await deletionWinsReference("document");
  });

  it("orders activation before deletion and retains the active version", async () => {
    await activationWinsDeletion();
  });

  it("orders deletion before activation and rejects activating the tombstone", async () => {
    await deletionWinsActivation();
  });

  it("protects active templates and pair- or document-referenced history", async () => {
    const activeId = await createTemplate(true);
    runSql(`INSERT INTO legal_document_pairs(id, deed_template_id) VALUES (${activeId + 30_000}, ${activeId})`);
    runSql(`INSERT INTO legal_documents(id, template_id) VALUES (${activeId + 40_000}, ${activeId})`);
    const activeDeletion = launchSql(
      `active_protection_${activeId}`,
      `UPDATE legal_templates SET deleted_at = now(), deleted_by_admin_id = 7 WHERE id = ${activeId}`,
    );
    const activeResult = await activeDeletion.done;
    expect(activeResult.code).not.toBe(0);
    expect(activeResult.stderr).toContain("cannot be cleared or activated");

    for (const [kind, referenceId] of [
      ["pair", activeId + 50_000],
      ["document", activeId + 60_000],
    ] as const) {
      const referencedId = await createTemplate();
      runSql(addReferenceSql(kind, referenceId, referencedId));
      const deletion = launchSql(
        `referenced_protection_${kind}_${referencedId}`,
        `UPDATE legal_templates SET deleted_at = now(), deleted_by_admin_id = 7 WHERE id = ${referencedId}`,
      );
      const result = await deletion.done;
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain("Referenced legal template versions cannot be deleted");
    }
  });
});