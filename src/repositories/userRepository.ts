import type { Pool, ResultSetHeader } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";

export type UserRow = {
  id: bigint;
  email: string;
  password_hash: string;
  full_name: string;
  phone: string | null;
  /** Present after optional migration / self-heal */
  phone_verified_at?: Date | null;
  status: "active" | "inactive" | "blocked";
};

export async function findUserByEmail(pool: Pool, email: string): Promise<UserRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id, email, password_hash, full_name, phone, phone_verified_at, status FROM users WHERE email = ? LIMIT 1",
    [email.toLowerCase()]
  );
  if (!rows.length) return null;
  const r = rows[0] as UserRow;
  return { ...r, id: BigInt(r.id as unknown as string) };
}

export async function findUserByPhone(pool: Pool, phone: string): Promise<UserRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id, email, password_hash, full_name, phone, phone_verified_at, status FROM users WHERE phone = ? LIMIT 1",
    [phone]
  );
  if (!rows.length) return null;
  const r = rows[0] as UserRow;
  return { ...r, id: BigInt(r.id as unknown as string) };
}

export async function findUserById(pool: Pool, id: bigint): Promise<UserRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id, email, password_hash, full_name, phone, phone_verified_at, status FROM users WHERE id = ? LIMIT 1",
    [id]
  );
  if (!rows.length) return null;
  const r = rows[0] as UserRow;
  return { ...r, id: BigInt(r.id as unknown as string) };
}

export async function insertUser(
  pool: Pool,
  input: { email: string; passwordHash: string; fullName: string; phone?: string | null; pendingAdminReview?: boolean }
): Promise<bigint> {
  const pending = input.pendingAdminReview ? 1 : 0;
  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO users (email, password_hash, full_name, phone, pending_admin_review)
     VALUES (?, ?, ?, ?, ?)`,
    [input.email.toLowerCase(), input.passwordHash, input.fullName, input.phone ?? null, pending]
  );
  return BigInt(result.insertId);
}

export async function setPendingAdminReview(pool: Pool, userId: bigint, pending: boolean): Promise<void> {
  await pool.query("UPDATE users SET pending_admin_review = ? WHERE id = ?", [pending ? 1 : 0, userId]);
}

export async function setPhoneVerifiedAt(pool: Pool, userId: bigint): Promise<void> {
  await pool.query("UPDATE users SET phone_verified_at = NOW() WHERE id = ?", [userId]);
}

export async function userNeedsAdminReview(pool: Pool, userId: bigint): Promise<boolean> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT pending_admin_review FROM users WHERE id = ? LIMIT 1",
    [userId]
  );
  if (!rows.length) return false;
  return Number(rows[0].pending_admin_review ?? 0) === 1;
}

export async function approveUserAdminReview(pool: Pool, userId: bigint): Promise<boolean> {
  const [r] = await pool.query<ResultSetHeader>(
    "UPDATE users SET pending_admin_review = 0, status = 'active' WHERE id = ? AND pending_admin_review = 1",
    [userId]
  );
  return r.affectedRows > 0;
}

export async function getRoleCodesForUser(pool: Pool, userId: bigint): Promise<string[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT r.code FROM user_roles ur
     INNER JOIN roles r ON r.id = ur.role_id
     WHERE ur.user_id = ?`,
    [userId]
  );
  return rows.map((r) => String(r.code));
}

export async function assignRoleByCode(pool: Pool, userId: bigint, roleCode: string): Promise<void> {
  await pool.query(
    `INSERT IGNORE INTO user_roles (user_id, role_id)
     SELECT ?, id FROM roles WHERE code = ? LIMIT 1`,
    [userId, roleCode]
  );
}

export async function removeRoleByCode(pool: Pool, userId: bigint, roleCode: string): Promise<boolean> {
  const [r] = await pool.query<ResultSetHeader>(
    `DELETE ur FROM user_roles ur
     INNER JOIN roles r ON r.id = ur.role_id
     WHERE ur.user_id = ? AND r.code = ?`,
    [userId, roleCode]
  );
  return r.affectedRows > 0;
}

export async function listUsers(
  pool: Pool,
  opts?: {
    search?: string;
    role?: string;
    status?: "active" | "inactive" | "blocked";
    pendingReview?: boolean;
  }
) {
  const clauses: string[] = ["1=1"];
  const params: unknown[] = [];
  if (opts?.search?.trim()) {
    clauses.push("(u.email LIKE ? OR u.full_name LIKE ?)");
    const q = `%${opts.search.trim()}%`;
    params.push(q, q);
  }
  if (opts?.status) {
    clauses.push("u.status = ?");
    params.push(opts.status);
  }
  if (opts?.pendingReview === true) {
    clauses.push("u.pending_admin_review = 1");
  }
  if (opts?.role?.trim()) {
    clauses.push("EXISTS (SELECT 1 FROM user_roles ur INNER JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id AND r.code = ?)");
    params.push(opts.role.trim());
  }
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT u.id, u.email, u.full_name, u.phone, u.status, u.pending_admin_review, u.created_at,
            (SELECT GROUP_CONCAT(r.code ORDER BY r.code)
             FROM user_roles ur INNER JOIN roles r ON r.id = ur.role_id
             WHERE ur.user_id = u.id) AS role_codes_csv
     FROM users u
     WHERE ${clauses.join(" AND ")}
     ORDER BY u.id DESC
     LIMIT 200`,
    params
  );
  return rows.map((r) => ({
    id: String(r.id),
    email: String(r.email),
    fullName: String(r.full_name),
    phone: r.phone != null ? String(r.phone) : null,
    status: r.status as string,
    pendingAdminReview: Boolean(Number(r.pending_admin_review ?? 0)),
    createdAt: r.created_at,
    roleCodes: r.role_codes_csv ? String(r.role_codes_csv).split(",").filter(Boolean) : [],
  }));
}

export async function setUserStatus(pool: Pool, userId: bigint, status: "active" | "inactive" | "blocked") {
  const [r] = await pool.query<ResultSetHeader>("UPDATE users SET status = ? WHERE id = ?", [status, userId]);
  return r.affectedRows > 0;
}

export async function updateUserProfile(
  pool: Pool,
  userId: bigint,
  patch: { fullName?: string; phone?: string | null }
): Promise<void> {
  const fields: string[] = [];
  const params: unknown[] = [];
  if (patch.fullName !== undefined) {
    fields.push("full_name = ?");
    params.push(patch.fullName);
  }
  if (patch.phone !== undefined) {
    fields.push("phone = ?");
    params.push(patch.phone);
    fields.push("phone_verified_at = NULL");
  }
  if (!fields.length) return;
  params.push(userId);
  await pool.query(`UPDATE users SET ${fields.join(", ")} WHERE id = ?`, params);
}
