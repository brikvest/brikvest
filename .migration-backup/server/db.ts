import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from "ws";
import * as schema from "@shared/schema";

neonConfig.webSocketConstructor = ws;

// When NODE_ENV === "test" and TEST_DATABASE_URL is set, point the pool at the
// dedicated test database so the suite is fully isolated from dev/prod data.
// Otherwise fall back to the regular DATABASE_URL.  The runtime app server
// always uses DATABASE_URL because it never sets NODE_ENV=test.
const connectionString =
  process.env.NODE_ENV === "test" && process.env.TEST_DATABASE_URL
    ? process.env.TEST_DATABASE_URL
    : process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString });
export const db = drizzle({ client: pool, schema });