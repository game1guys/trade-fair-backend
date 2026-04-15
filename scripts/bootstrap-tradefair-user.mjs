/**
 * One-time: create `tradefair`@`%` user and grant on `tradefair` DB. Connects as MySQL admin.
 * Defaults: admin root + empty password. Override MYSQL_BOOTSTRAP_USER / MYSQL_BOOTSTRAP_PASSWORD.
 */
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env") });

const host = process.env.MYSQL_HOST ?? "127.0.0.1";
const port = Number(process.env.MYSQL_PORT ?? 3306);
const database = process.env.MYSQL_DATABASE ?? "tradefair";
const bootstrapUser =
  process.env.MYSQL_BOOTSTRAP_USER ?? process.env.MYSQL_USER ?? "root";
const bootstrapPassword =
  process.env.MYSQL_BOOTSTRAP_PASSWORD ?? process.env.MYSQL_PASSWORD ?? "";

const appUser = "tradefair";
const appPassword = process.env.MYSQL_APP_PASSWORD ?? "tradefair_dev";

const conn = await mysql.createConnection({
  host,
  port,
  user: bootstrapUser,
  password: bootstrapPassword,
  multipleStatements: true,
});

const safeDb = database.replace(/`/g, "");
const safePass = appPassword.replace(/'/g, "''");

await conn.query(
  `CREATE USER IF NOT EXISTS '${appUser}'@'localhost' IDENTIFIED BY '${safePass}'`
);
await conn.query(`CREATE USER IF NOT EXISTS '${appUser}'@'%' IDENTIFIED BY '${safePass}'`);
await conn.query(`GRANT ALL PRIVILEGES ON \`${safeDb}\`.* TO '${appUser}'@'localhost'`);
await conn.query(`GRANT ALL PRIVILEGES ON \`${safeDb}\`.* TO '${appUser}'@'%'`);
await conn.query("FLUSH PRIVILEGES");
await conn.end();
console.log(`User '${appUser}' can use database '${safeDb}'.`);
