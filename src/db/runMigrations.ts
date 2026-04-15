import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import mysql, { type RowDataPacket } from "mysql2/promise";
import { env } from "../config/env.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function isUnknownDatabase(err: unknown): boolean {
  const e = err as { code?: string; errno?: number };
  return e.code === "ER_BAD_DB_ERROR" || e.errno === 1049;
}

async function connectWithoutDb() {
  return mysql.createConnection({
    host: env.mysql.host,
    port: env.mysql.port,
    user: env.mysql.user,
    password: env.mysql.password,
    multipleStatements: true,
  });
}

async function ensureDatabaseExists(): Promise<void> {
  const conn = await connectWithoutDb();
  try {
    await conn.query(
      `CREATE DATABASE IF NOT EXISTS \`${env.mysql.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
  } finally {
    await conn.end();
  }
}

function createPool() {
  return mysql.createPool({
    host: env.mysql.host,
    port: env.mysql.port,
    user: env.mysql.user,
    password: env.mysql.password,
    database: env.mysql.database,
    multipleStatements: true,
  });
}

async function openPoolWithDatabase(): Promise<mysql.Pool> {
  const pool = createPool();
  try {
    const c = await pool.getConnection();
    c.release();
    return pool;
  } catch (err) {
    await pool.end();
    if (!isUnknownDatabase(err)) throw err;
    await ensureDatabaseExists();
    const pool2 = createPool();
    const c2 = await pool2.getConnection();
    c2.release();
    return pool2;
  }
}

async function main() {
  const pool = await openPoolWithDatabase();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      filename VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  const migrationsDir = path.join(__dirname, "migrations");
  const files = (await fs.readdir(migrationsDir))
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const [appliedRows] = await pool.query<RowDataPacket[]>(
    "SELECT filename FROM schema_migrations ORDER BY id ASC"
  );
  const applied = new Set(appliedRows.map((r) => String(r.filename)));

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query(sql);
      await conn.query("INSERT INTO schema_migrations (filename) VALUES (?)", [file]);
      await conn.commit();
      console.log(`Applied migration: ${file}`);
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  }

  await pool.end();
  console.log("Migrations complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
