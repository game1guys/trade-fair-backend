import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config({ path: new URL("../.env", import.meta.url) });

const email = process.argv[2];
const roleCode = process.argv[3];

if (!email || !roleCode) {
  console.error("Usage: node scripts/assign-role-by-email.mjs <email> <ROLE_CODE>");
  process.exit(1);
}

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST ?? "127.0.0.1",
  port: Number(process.env.MYSQL_PORT ?? 3306),
  user: process.env.MYSQL_USER ?? "root",
  password: process.env.MYSQL_PASSWORD ?? "",
  database: process.env.MYSQL_DATABASE ?? "tradefair",
});

const [[u]] = await pool.query("SELECT id, email FROM users WHERE email = ? LIMIT 1", [email]);
if (!u) {
  console.error(`User not found: ${email}`);
  await pool.end();
  process.exit(1);
}

const [[r]] = await pool.query("SELECT id, code FROM roles WHERE code = ? LIMIT 1", [roleCode]);
if (!r) {
  console.error(`Role not found: ${roleCode}`);
  await pool.end();
  process.exit(1);
}

await pool.query("INSERT IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)", [u.id, r.id]);
console.log(JSON.stringify({ assigned: true, email: String(u.email), role: String(r.code) }));
await pool.end();

