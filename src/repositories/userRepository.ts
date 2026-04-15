import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

export type UserRow = {
  id: bigint;
  email: string;
  password_hash: string;
  full_name: string;
  phone: string | null;
  status: "active" | "inactive" | "blocked";
};

export async function findUserByEmail(pool: Pool, email: string): Promise<UserRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id, email, password_hash, full_name, phone, status FROM users WHERE email = ? LIMIT 1",
    [email.toLowerCase()]
  );
  if (!rows.length) return null;
  const r = rows[0] as UserRow;
  return { ...r, id: BigInt(r.id as unknown as string) };
}

export async function findUserById(pool: Pool, id: bigint): Promise<UserRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id, email, password_hash, full_name, phone, status FROM users WHERE id = ? LIMIT 1",
    [id]
  );
  if (!rows.length) return null;
  const r = rows[0] as UserRow;
  return { ...r, id: BigInt(r.id as unknown as string) };
}

export async function insertUser(
  pool: Pool,
  input: { email: string; passwordHash: string; fullName: string; phone?: string | null }
): Promise<bigint> {
  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO users (email, password_hash, full_name, phone)
     VALUES (?, ?, ?, ?)`,
    [input.email.toLowerCase(), input.passwordHash, input.fullName, input.phone ?? null]
  );
  return BigInt(result.insertId);
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
    `INSERT INTO user_roles (user_id, role_id)
     SELECT ?, id FROM roles WHERE code = ? LIMIT 1`,
    [userId, roleCode]
  );
}

export async function listUsers(
  pool: Pool,
  opts?: { search?: string; role?: string; status?: "active" | "inactive" | "blocked" }
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
  if (opts?.role?.trim()) {
    clauses.push("EXISTS (SELECT 1 FROM user_roles ur INNER JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id AND r.code = ?)");
    params.push(opts.role.trim());
  }
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT u.id, u.email, u.full_name, u.phone, u.status, u.created_at
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
    createdAt: r.created_at,
  }));
}

export async function setUserStatus(pool: Pool, userId: bigint, status: "active" | "inactive" | "blocked") {
  const [r] = await pool.query<ResultSetHeader>("UPDATE users SET status = ? WHERE id = ?", [status, userId]);
  return r.affectedRows > 0;
}
