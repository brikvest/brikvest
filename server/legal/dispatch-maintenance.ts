import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";

// Session-level shared permits cover the entire dispatch, including external
// work. A controlled migration takes the exclusive counterpart on its verified
// target connection. No business rows or persistent schema are used for pausing.
export const LEGAL_DISPATCH_LOCK = [1279608641, 1] as const;
export const LEGAL_DISPATCH_PROTOCOL = "exact-pdf-review-dispatch-maintenance-v1";
export const LEGAL_DISPATCH_PAUSE_PROTOCOL = "persistent-legal-dispatch-pause-v1";
export const legalDispatchPaused = () => process.env.LEGAL_DISPATCH_PAUSED === "true";

type PermitClient = {
  query(text: string, values: number[]): Promise<{ rows: Array<{ acquired?: boolean; released?: boolean }> }>;
  release(destroy?: boolean): void;
  on?(event: "error", listener: (error: Error) => void): unknown;
  off?(event: "error", listener: (error: Error) => void): unknown;
};

let permitPool: Pool | undefined;
async function connectPermitClient(): Promise<PermitClient> {
  if (!permitPool) {
    neonConfig.webSocketConstructor = ws;
    const connectionString = process.env.NODE_ENV === "test"
      ? process.env.TEST_DATABASE_URL
      : process.env.DATABASE_URL;
    if (!connectionString) throw new Error("Legal dispatch permit database is not configured.");
    // Separate from the business-query pool: dispatches must not occupy every
    // business connection while waiting for the repository to acquire one.
    permitPool = new Pool({ connectionString, max: 4, connectionTimeoutMillis: 10_000, idleTimeoutMillis: 5_000 });
    permitPool.on("error", () => console.error("[LEGAL] Dispatch permit connection failed."));
  }
  return permitPool.connect();
}

export async function withLegalDispatchPermit<T>(
  operation: (isPermitLive: () => boolean) => Promise<T>,
  connect: () => Promise<PermitClient> = connectPermitClient,
): Promise<T | null> {
  // Persist across publications and restarts. Neither scheduled dispatch nor
  // administrator recovery may connect, claim work or send while paused.
  if (legalDispatchPaused()) return null;
  const client = await connect();
  let acquired = false;
  let denied = false;
  let destroy = true;
  let connectionLost = false;
  const onConnectionError = () => { connectionLost = true; };
  client.on?.("error", onConnectionError);
  try {
    const lockResult = (await client.query(
      "SELECT pg_try_advisory_lock_shared($1, $2) AS acquired",
      [...LEGAL_DISPATCH_LOCK],
    )).rows[0]?.acquired;
    if (lockResult === false) {
      denied = true;
      return null;
    }
    if (lockResult !== true) throw new Error("Legal dispatch permit acquisition could not be verified.");
    acquired = true;
    if (connectionLost) throw new Error("Legal dispatch permit connection was lost.");
    const result = await operation(() => !connectionLost);
    if (connectionLost) throw new Error("Legal dispatch permit connection was lost.");
    return result;
  } finally {
    try {
      if (acquired && !connectionLost) {
        const unlocked = await client.query(
          "SELECT pg_advisory_unlock_shared($1, $2) AS released",
          [...LEGAL_DISPATCH_LOCK],
        );
        destroy = unlocked.rows[0]?.released !== true;
        if (destroy) throw new Error("Legal dispatch permit release could not be verified.");
      } else if (denied && !connectionLost) {
        destroy = false;
      }
    } finally {
      // Never return a connection with a possibly retained session lock.
      client.off?.("error", onConnectionError);
      client.release(destroy);
    }
  }
}