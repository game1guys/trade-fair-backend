import type { Pool, RowDataPacket } from "mysql2/promise";

/** All operational admin modules; excludes financial (permission-gated, not scopes). */
export const SUB_ADMIN_DEFAULT_SCOPES = [
  "kyc",
  "support",
  "settings",
  "notifications",
  "moderation",
  "sub_admins",
] as const;

export const SUB_ADMIN_ALLOWED_SCOPE_CODES = [...SUB_ADMIN_DEFAULT_SCOPES] as string[];

export async function listScopesForSubAdmin(pool: Pool, userId: bigint): Promise<string[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT scope_code FROM sub_admin_scopes WHERE sub_admin_user_id = ? ORDER BY scope_code ASC",
    [userId]
  );
  return rows.map((r) => String(r.scope_code));
}

export async function listSubAdmins(pool: Pool): Promise<
  { userId: string; email: string; fullName: string; status: string; scopes: string[]; createdAt: unknown }[]
> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT u.id, u.email, u.full_name, u.status, u.created_at,
            (SELECT GROUP_CONCAT(s.scope_code ORDER BY s.scope_code)
             FROM sub_admin_scopes s WHERE s.sub_admin_user_id = u.id) AS scopes_csv
     FROM users u
     INNER JOIN user_roles ur ON ur.user_id = u.id
     INNER JOIN roles r ON r.id = ur.role_id AND r.code = 'SUB_ADMIN'
     ORDER BY u.id DESC
     LIMIT 200`
  );
  return rows.map((r) => ({
    userId: String(r.id),
    email: String(r.email),
    fullName: String(r.full_name),
    status: String(r.status),
    scopes: r.scopes_csv ? String(r.scopes_csv).split(",").filter(Boolean) : [],
    createdAt: r.created_at,
  }));
}

export async function replaceScopesForSubAdmin(pool: Pool, userId: bigint, scopes: string[]): Promise<void> {
  const allowed = new Set(SUB_ADMIN_ALLOWED_SCOPE_CODES);
  const normalized = [...new Set(scopes.map((s) => s.trim()).filter((s) => allowed.has(s)))];
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query("DELETE FROM sub_admin_scopes WHERE sub_admin_user_id = ?", [userId]);
    for (const s of normalized) {
      await conn.query(
        "INSERT INTO sub_admin_scopes (sub_admin_user_id, scope_code) VALUES (?, ?)",
        [userId, s]
      );
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

