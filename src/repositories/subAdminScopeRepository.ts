import type { Pool, RowDataPacket } from "mysql2/promise";

export async function listScopesForSubAdmin(pool: Pool, userId: bigint): Promise<string[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT scope_code FROM sub_admin_scopes WHERE sub_admin_user_id = ? ORDER BY scope_code ASC",
    [userId]
  );
  return rows.map((r) => String(r.scope_code));
}

export async function replaceScopesForSubAdmin(pool: Pool, userId: bigint, scopes: string[]): Promise<void> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query("DELETE FROM sub_admin_scopes WHERE sub_admin_user_id = ?", [userId]);
    for (const s of scopes) {
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

