import type { Pool, RowDataPacket } from "mysql2/promise";

export async function getPermissionCodesForUser(pool: Pool, userId: bigint): Promise<string[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT DISTINCT p.code AS code
     FROM user_roles ur
     INNER JOIN role_permissions rp ON rp.role_id = ur.role_id
     INNER JOIN permissions p ON p.id = rp.permission_id
     WHERE ur.user_id = ?`,
    [userId]
  );
  return rows.map((r) => String(r.code));
}
