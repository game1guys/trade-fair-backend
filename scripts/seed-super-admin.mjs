/**
 * Create or update the platform super admin and ensure SUPER_ADMIN role.
 * Default: rk.tradefair@gmail.com / Test@123
 * Override: SUPER_ADMIN_EMAIL SUPER_ADMIN_PASSWORD
 */
import bcrypt from "bcryptjs";
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env") });

const email = (process.env.SUPER_ADMIN_EMAIL ?? "rk.tradefair@gmail.com").toLowerCase().trim();
const password = process.env.SUPER_ADMIN_PASSWORD ?? "Test@123";
const fullName = process.env.SUPER_ADMIN_NAME ?? "Platform Super Admin";

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST ?? "127.0.0.1",
  port: Number(process.env.MYSQL_PORT ?? 3306),
  user: process.env.MYSQL_USER ?? "root",
  password: process.env.MYSQL_PASSWORD ?? "",
  database: process.env.MYSQL_DATABASE ?? "tradefair",
});

const hash = bcrypt.hashSync(password, 12);

const conn = await pool.getConnection();
try {
  await conn.beginTransaction();
  const [[existing]] = await conn.query("SELECT id FROM users WHERE email = ? LIMIT 1", [email]);
  let userId;
  if (existing) {
    userId = existing.id;
    await conn.query(
      `UPDATE users SET password_hash = ?, full_name = ?, status = 'active' WHERE id = ?`,
      [hash, fullName, userId]
    );
    console.log(JSON.stringify({ updated: true, email, userId: String(userId) }));
  } else {
    const [ins] = await conn.query(
      `INSERT INTO users (email, password_hash, full_name, status) VALUES (?,?,?, 'active')`,
      [email, hash, fullName]
    );
    userId = ins.insertId;
    console.log(JSON.stringify({ created: true, email, userId: String(userId) }));
  }

  const [[role]] = await conn.query("SELECT id FROM roles WHERE code = 'SUPER_ADMIN' LIMIT 1");
  if (!role) {
    throw new Error("SUPER_ADMIN role missing — run migrations first.");
  }
  await conn.query("INSERT IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)", [userId, role.id]);
  await conn.commit();
  console.log("SUPER_ADMIN role assigned.");
} catch (e) {
  await conn.rollback();
  console.error(e);
  process.exitCode = 1;
} finally {
  conn.release();
  await pool.end();
}
