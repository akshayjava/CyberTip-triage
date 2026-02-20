/**
 * PostgreSQL connection pool.
 * Only used when DB_MODE=postgres. All other environments use in-memory stubs.
 */

let pool: import("pg").Pool | null = null;

export function getPool(): import("pg").Pool {
  if (!pool) {
    // Dynamic import avoids requiring pg to be installed in test environments
    const { Pool } = require("pg") as typeof import("pg");
    pool = new Pool({
      connectionString:
        process.env["DATABASE_URL"] ??
        "postgresql://localhost:5432/cybertip_triage",
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
