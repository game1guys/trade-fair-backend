import type { Pool, ResultSetHeader } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";

export async function listRoles(pool: Pool) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, code, name, sort_order, created_at
     FROM roles
     ORDER BY sort_order ASC, id ASC`
  );
  return rows.map((r) => ({
    id: String(r.id),
    code: String(r.code),
    name: String(r.name),
    sortOrder: Number(r.sort_order ?? 0),
    createdAt: r.created_at,
  }));
}

export async function getRoleById(pool: Pool, roleId: number) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, code, name, sort_order, created_at
     FROM roles
     WHERE id = ?
     LIMIT 1`,
    [roleId]
  );
  if (!rows.length) return null;
  const r = rows[0];
  return {
    id: String(r.id),
    code: String(r.code),
    name: String(r.name),
    sortOrder: Number(r.sort_order ?? 0),
    createdAt: r.created_at,
  };
}

export async function listPermissionCodes(pool: Pool) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT code
     FROM permissions
     ORDER BY code ASC`
  );
  return rows.map((r) => String(r.code));
}

export async function listRolePermissionCodes(pool: Pool, roleId: number) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT p.code
     FROM role_permissions rp
     INNER JOIN permissions p ON p.id = rp.permission_id
     WHERE rp.role_id = ?
     ORDER BY p.code ASC`,
    [roleId]
  );
  return rows.map((r) => String(r.code));
}

/** Full RBAC matrix: every role × every permission (granted boolean). */
export async function getRbacPermissionMatrix(pool: Pool) {
  const [roles] = await pool.query<RowDataPacket[]>(
    `SELECT id, code, name, sort_order FROM roles ORDER BY sort_order ASC, id ASC`
  );
  const [perms] = await pool.query<RowDataPacket[]>(`SELECT id, code FROM permissions ORDER BY code ASC`);
  const [links] = await pool.query<RowDataPacket[]>(
    `SELECT role_id, permission_id FROM role_permissions`
  );
  const linkSet = new Set(links.map((l) => `${Number(l.role_id)}:${Number(l.permission_id)}`));
  const roleOut = roles.map((r) => ({
    id: String(r.id),
    code: String(r.code),
    name: String(r.name),
  }));
  const permOut = perms.map((p) => ({ id: String(p.id), code: String(p.code) }));
  const matrix: Record<string, Record<string, boolean>> = {};
  for (const r of roles) {
    const rid = Number(r.id);
    matrix[String(rid)] = {};
    for (const p of perms) {
      const pid = Number(p.id);
      matrix[String(rid)][String(p.code)] = linkSet.has(`${rid}:${pid}`);
    }
  }
  return { roles: roleOut, permissions: permOut, matrix };
}

export async function putRbacMatrixFromPayload(
  pool: Pool,
  rolesMap: Record<string, string[]>
): Promise<{ failedRoleId?: number }> {
  for (const [roleIdStr, codes] of Object.entries(rolesMap)) {
    const roleId = Number(roleIdStr);
    if (!Number.isFinite(roleId) || roleId <= 0) continue;
    const ok = await replaceRolePermissionsByCodes(pool, roleId, codes);
    if (!ok) return { failedRoleId: roleId };
  }
  return {};
}

export async function replaceRolePermissionsByCodes(
  pool: Pool,
  roleId: number,
  permissionCodes: string[]
): Promise<boolean> {
  // Verify role exists
  const role = await getRoleById(pool, roleId);
  if (!role) return false;

  // Map codes -> permission IDs
  const codes = Array.from(new Set(permissionCodes.map(String)));
  if (codes.length === 0) {
    await pool.query("DELETE FROM role_permissions WHERE role_id = ?", [roleId]);
    return true;
  }

  const placeholders = codes.map(() => "?").join(",");
  const [permRows] = await pool.query<RowDataPacket[]>(
    `SELECT id, code FROM permissions WHERE code IN (${placeholders})`,
    codes
  );
  const ids = permRows.map((r) => Number(r.id));

  await pool.query("DELETE FROM role_permissions WHERE role_id = ?", [roleId]);

  if (!ids.length) return true;

  const valuesSql = ids.map(() => "(?, ?)").join(",");
  const vals: unknown[] = [];
  for (const pid of ids) {
    vals.push(roleId, pid);
  }
  await pool.query<ResultSetHeader>(`INSERT INTO role_permissions (role_id, permission_id) VALUES ${valuesSql}`, vals);
  return true;
}

