import mysql from "mysql2/promise";
import dotenv from "dotenv";

// Load backend/.env regardless of cwd
dotenv.config({ path: new URL("../.env", import.meta.url) });

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST ?? "127.0.0.1",
  port: Number(process.env.MYSQL_PORT ?? 3306),
  user: process.env.MYSQL_USER ?? "root",
  password: process.env.MYSQL_PASSWORD ?? "",
  database: process.env.MYSQL_DATABASE ?? "tradefair",
});

const [[u]] = await pool.query("SELECT id, email FROM users ORDER BY id DESC LIMIT 1");
if (!u) {
  console.error("No users found in DB");
  process.exitCode = 1;
  await pool.end();
  process.exit(1);
}
const [[r]] = await pool.query("SELECT id FROM roles WHERE code = 'ORGANIZER' LIMIT 1");
if (!r) {
  console.error("ORGANIZER role missing in roles table");
  process.exitCode = 1;
  await pool.end();
  process.exit(1);
}

await pool.query("INSERT IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)", [u.id, r.id]);

console.log(JSON.stringify({ assigned: true, userId: String(u.id), email: String(u.email) }));
await pool.end();

