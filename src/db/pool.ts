/**
 * PostgreSQL connection pool.
 * Only used when DB_MODE=postgres. All other environments use in-memory stubs.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

let pool: import("pg").Pool | null = null;

export function getPool(): import("pg").Pool {
  if (!pool) {
    // Lazy require avoids requiring pg to be installed in test environments
    const { Pool } = require("pg") as typeof import("pg");
    const connectionString = process.env["DATABASE_URL"];

    if (!connectionString) {
      throw new Error("DATABASE_URL environment variable is not defined");
    }

    pool = new Pool({
      connectionString,
      max: 20,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 2_000,
    });

    pool.on("error", (err) => {
      console.error("Unexpected DB pool error:", err);
    });
  }

  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
