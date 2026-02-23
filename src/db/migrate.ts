import { readdir, readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { getPool, closePool } from "./pool.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function migrate() {
  if (process.env["DB_MODE"] !== "postgres") {
    console.log("Skipping migrations: DB_MODE is not 'postgres'");
    return;
  }

  const pool = getPool();
  const migrationsDir = join(__dirname, "migrations");

  try {
    const files = await readdir(migrationsDir);
    const sqlFiles = files.filter(f => f.endsWith(".sql")).sort();

    console.log(`Found ${sqlFiles.length} migrations.`);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      for (const file of sqlFiles) {
        console.log(`Running ${file}...`);
        const content = await readFile(join(migrationsDir, file), "utf-8");
        await client.query(content);
      }

      await client.query("COMMIT");
      console.log("Migrations complete.");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("Migration failed:", err);
    process.exit(1);
  } finally {
    await closePool();
  }
}

migrate();
