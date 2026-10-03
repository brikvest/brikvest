import { afterEach, describe, expect, it, vi } from "vitest";
import { LEGAL_DISPATCH_LOCK, withLegalDispatchPermit } from "../server/legal/dispatch-maintenance";
import { runStartupDataMaintenance } from "../server/startup-maintenance";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

afterEach(() => vi.unstubAllEnvs());

function client(acquired: boolean) {
  return {
    query: vi.fn(async (text: string, _values: number[]) => ({
      rows: text.includes("unlock") ? [{ released: true }] : [{ acquired }],
    })),
    release: vi.fn(),
  };
}

describe("legal dispatch maintenance permits", () => {
  it("does not begin work when the verified database has an exclusive maintenance lock", async () => {
    const connection = client(false);
    const operation = vi.fn();
    expect(await withLegalDispatchPermit(operation, async () => connection)).toBeNull();
    expect(operation).not.toHaveBeenCalled();
    expect(connection.query).toHaveBeenCalledExactlyOnceWith(
      "SELECT pg_try_advisory_lock_shared($1, $2) AS acquired", [...LEGAL_DISPATCH_LOCK],
    );
    expect(connection.release).toHaveBeenCalledWith(false);
  });

  it("retains its shared permit until the operation settles", async () => {
    const connection = client(true);
    let finish!: (value: string) => void;
    const operation = new Promise<string>((resolve) => { finish = resolve; });
    const dispatch = withLegalDispatchPermit(() => operation, async () => connection);
    await vi.waitFor(() => expect(connection.query).toHaveBeenCalledTimes(1));
    expect(connection.release).not.toHaveBeenCalled();
    finish("done");
    expect(await dispatch).toBe("done");
    expect(connection.query).toHaveBeenLastCalledWith(
      "SELECT pg_advisory_unlock_shared($1, $2) AS released", [...LEGAL_DISPATCH_LOCK],
    );
    expect(connection.release).toHaveBeenCalledWith(false);
  });

  it("releases the permit after a failed operation", async () => {
    const connection = client(true);
    await expect(withLegalDispatchPermit(async () => { throw new Error("operation failed"); }, async () => connection))
      .rejects.toThrow("operation failed");
    expect(connection.query).toHaveBeenCalledTimes(2);
    expect(connection.release).toHaveBeenCalledWith(false);
  });

  it("fails closed on acquisition errors and destroys the connection", async () => {
    const connection = client(true);
    connection.query.mockRejectedValueOnce(new Error("lock query failed"));
    const operation = vi.fn();
    await expect(withLegalDispatchPermit(operation, async () => connection)).rejects.toThrow("lock query failed");
    expect(operation).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalledWith(true);
  });

  it("destroys the connection if unlocking cannot be verified", async () => {
    const connection = client(true);
    connection.query.mockResolvedValueOnce({ rows: [{ acquired: true }] });
    connection.query.mockResolvedValueOnce({ rows: [{ released: false }] });
    await expect(withLegalDispatchPermit(async () => "done", async () => connection))
      .rejects.toThrow("release could not be verified");
    expect(connection.release).toHaveBeenCalledWith(true);
  });

  it("fails closed when the lock response is incomplete", async () => {
    const connection = client(true);
    connection.query.mockResolvedValueOnce({ rows: [] });
    const operation = vi.fn();
    await expect(withLegalDispatchPermit(operation, async () => connection))
      .rejects.toThrow("acquisition could not be verified");
    expect(operation).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalledWith(true);
  });

  it("fails closed when a held permit connection is lost", async () => {
    let lost!: (error: Error) => void;
    const connection = {
      ...client(true),
      on: vi.fn((_event: "error", listener: (error: Error) => void) => { lost = listener; }),
      off: vi.fn(),
    };
    await expect(withLegalDispatchPermit(async (isPermitLive) => {
      expect(isPermitLive()).toBe(true);
      lost(new Error("connection lost"));
      expect(isPermitLive()).toBe(false);
    }, async () => connection)).rejects.toThrow("connection was lost");
    expect(connection.query).toHaveBeenCalledTimes(1);
    expect(connection.release).toHaveBeenCalledWith(true);
  });
});

describe("schema-only publication startup", () => {
  it("does not run business repairs or expiry operations when explicitly skipped", async () => {
    vi.stubEnv("SKIP_STARTUP_DATA_MAINTENANCE", "true");
    const repair = vi.fn();
    await runStartupDataMaintenance(repair);
    expect(repair).not.toHaveBeenCalled();
  });

  it("preserves normal startup maintenance outside the controlled rollout", async () => {
    vi.stubEnv("SKIP_STARTUP_DATA_MAINTENANCE", "");
    const repair = vi.fn(async () => undefined);
    await runStartupDataMaintenance(repair);
    expect(repair).toHaveBeenCalledOnce();
  });

  it.each(["environment", "merged configuration"])("prevents legacy merge mutations using %s", (mode) => {
    const dir = mkdtempSync(path.join(tmpdir(), "legal-schema-only-hook-"));
    try {
      writeFileSync(path.join(dir, ".replit"),
        `[userenv.production]\nSKIP_POST_MERGE_DATABASE_MUTATIONS = "false"\n[userenv.development]\nSKIP_POST_MERGE_DATABASE_MUTATIONS = "${mode === "merged configuration"}"\n`);
      writeFileSync(path.join(dir, "npm"), "#!/bin/sh\necho MOCK_DEPENDENCY_INSTALL\n", { mode: 0o755 });
      for (const command of ["npx", "psql"]) {
        writeFileSync(path.join(dir, command), "#!/bin/sh\necho UNEXPECTED_DATABASE_COMMAND >&2\nexit 91\n", { mode: 0o755 });
      }
      const output = execFileSync("bash", [path.resolve(import.meta.dirname, "..", "scripts/post-merge.sh")], {
        cwd: dir,
        encoding: "utf8",
        env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, SKIP_POST_MERGE_DATABASE_MUTATIONS: String(mode === "environment") },
      });
      expect(output).toContain("MOCK_DEPENDENCY_INSTALL");
      expect(output).toContain("skipped post-merge database mutations");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});