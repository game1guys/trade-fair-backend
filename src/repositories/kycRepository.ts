import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

export async function insertKycDocument(
  pool: Pool,
  input: {
    userId: bigint;
    roleCode: string;
    docType: string;
    docUrl: string;
    meta: Record<string, unknown> | null;
  }
): Promise<bigint> {
  const [r] = await pool.query<ResultSetHeader>(
    `INSERT INTO kyc_documents (user_id, role_code, doc_type, doc_url, meta_json)
     VALUES (?,?,?,?,?)`,
    [input.userId, input.roleCode, input.docType, input.docUrl, input.meta ? JSON.stringify(input.meta) : null]
  );
  return BigInt(r.insertId);
}

export async function listMyKyc(pool: Pool, userId: bigint) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, role_code, doc_type, doc_url, status, remarks, reviewed_at, created_at
     FROM kyc_documents WHERE user_id = ? ORDER BY id DESC`,
    [userId]
  );
  return rows.map((r) => ({
    id: String(r.id),
    roleCode: String(r.role_code),
    docType: String(r.doc_type),
    docUrl: String(r.doc_url),
    status: String(r.status),
    remarks: r.remarks != null ? String(r.remarks) : null,
    reviewedAt: r.reviewed_at,
    createdAt: r.created_at,
  }));
}

export async function adminListKyc(
  pool: Pool,
  opts?: { status?: string; roleCode?: string }
) {
  const clauses: string[] = ["1=1"];
  const params: unknown[] = [];
  if (opts?.status) {
    clauses.push("k.status = ?");
    params.push(opts.status);
  }
  if (opts?.roleCode?.trim()) {
    clauses.push("k.role_code = ?");
    params.push(opts.roleCode.trim());
  }
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT k.id, k.user_id, u.email, u.full_name, k.role_code, k.doc_type, k.doc_url,
            k.status, k.remarks, k.reviewed_by_user_id, k.reviewed_at, k.created_at
     FROM kyc_documents k
     INNER JOIN users u ON u.id = k.user_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY k.id DESC
     LIMIT 200`,
    params
  );
  return rows.map((r) => ({
    id: String(r.id),
    userId: String(r.user_id),
    userEmail: String(r.email),
    userFullName: String(r.full_name),
    roleCode: String(r.role_code),
    docType: String(r.doc_type),
    docUrl: String(r.doc_url),
    status: String(r.status),
    remarks: r.remarks != null ? String(r.remarks) : null,
    reviewedByUserId: r.reviewed_by_user_id != null ? String(r.reviewed_by_user_id) : null,
    reviewedAt: r.reviewed_at,
    createdAt: r.created_at,
  }));
}

export async function adminReviewKyc(
  pool: Pool,
  input: { docId: bigint; reviewerUserId: bigint; status: "approved" | "rejected"; remarks: string | null }
): Promise<boolean> {
  const [r] = await pool.query<ResultSetHeader>(
    `UPDATE kyc_documents
     SET status = ?, remarks = ?, reviewed_by_user_id = ?, reviewed_at = NOW()
     WHERE id = ?`,
    [input.status, input.remarks, input.reviewerUserId, input.docId]
  );
  return r.affectedRows > 0;
}

