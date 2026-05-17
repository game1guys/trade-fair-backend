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
    [input.userId, input.roleCode.trim().toUpperCase(), input.docType, input.docUrl, input.meta ? JSON.stringify(input.meta) : null]
  );
  return BigInt(r.insertId);
}

/** Doc types that count toward organizer verification (uploads must be under role ORGANIZER). */
const ORGANIZER_KYC_DOC_TYPES_APPROVED = [
  "organizer_business_proof",
  "aadhaar_card",
  "organizer_genuineness",
  "pan_card",
] as const;

function organizerKycDocTypePlaceholders() {
  return ORGANIZER_KYC_DOC_TYPES_APPROVED.map(() => "?").join(",");
}

/** True when the user has at least one approved organizer-role KYC document of a supported type. */
export async function hasOrganizerIdentityKycApproved(pool: Pool, userId: bigint): Promise<boolean> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT 1 FROM kyc_documents
     WHERE user_id = ?
       AND LOWER(TRIM(CAST(status AS CHAR))) = 'approved'
       AND UPPER(TRIM(role_code)) = 'ORGANIZER'
       AND LOWER(TRIM(doc_type)) IN (${organizerKycDocTypePlaceholders()})
     LIMIT 1`,
    [userId, ...ORGANIZER_KYC_DOC_TYPES_APPROVED]
  );
  return rows.length > 0;
}

/** Mark a row approved without a human reviewer (dev auto-approve / trusted pipelines). */
export async function markKycDocumentAutoApproved(pool: Pool, docId: bigint, remarks: string): Promise<void> {
  await pool.query<ResultSetHeader>(
    `UPDATE kyc_documents
     SET status = 'approved', remarks = ?, reviewed_by_user_id = NULL, reviewed_at = NOW()
     WHERE id = ?`,
    [remarks, docId]
  );
}

export async function listMyKyc(pool: Pool, userId: bigint, opts?: { roleCode?: string }) {
  const params: unknown[] = [userId];
  let roleClause = "";
  if (opts?.roleCode?.trim()) {
    roleClause = " AND UPPER(role_code) = ?";
    params.push(opts.roleCode.trim().toUpperCase());
  }
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, role_code, doc_type, doc_url, meta_json, status, remarks, reviewed_at, created_at
     FROM kyc_documents WHERE user_id = ?${roleClause} ORDER BY id DESC`,
    params
  );
  return rows.map((r) => ({
    id: String(r.id),
    roleCode: String(r.role_code),
    docType: String(r.doc_type),
    docUrl: String(r.doc_url),
    meta: parseMeta(r.meta_json),
    status: String(r.status),
    remarks: r.remarks != null ? String(r.remarks) : null,
    reviewedAt: r.reviewed_at,
    createdAt: r.created_at,
  }));
}

function parseMeta(raw: unknown): Record<string, unknown> | null {
  if (raw == null) return null;
  if (typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    try {
      const o = JSON.parse(raw) as unknown;
      return typeof o === "object" && o != null && !Array.isArray(o) ? (o as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return null;
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
    clauses.push("UPPER(k.role_code) = ?");
    params.push(opts.roleCode.trim().toUpperCase());
  }
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT k.id, k.user_id, u.email, u.full_name, k.role_code, k.doc_type, k.doc_url, k.meta_json,
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
    meta: parseMeta(r.meta_json),
    status: String(r.status),
    remarks: r.remarks != null ? String(r.remarks) : null,
    reviewedByUserId: r.reviewed_by_user_id != null ? String(r.reviewed_by_user_id) : null,
    reviewedAt: r.reviewed_at,
    createdAt: r.created_at,
  }));
}

export async function findKycDocumentById(pool: Pool, docId: bigint) {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id, user_id, role_code, status FROM kyc_documents WHERE id = ? LIMIT 1",
    [docId]
  );
  return rows.length ? rows[0] : null;
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

