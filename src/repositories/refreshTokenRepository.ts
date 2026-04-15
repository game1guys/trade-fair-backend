import type { Pool, RowDataPacket } from "mysql2/promise";

export async function insertRefreshToken(
  pool: Pool,
  input: { userId: bigint; jti: string; tokenHash: string; expiresAt: Date }
): Promise<void> {
  await pool.query(
    `INSERT INTO refresh_tokens (user_id, jti, token_hash, expires_at) VALUES (?, ?, ?, ?)`,
    [input.userId, input.jti, input.tokenHash, input.expiresAt]
  );
}

export async function findRefreshTokenByJti(
  pool: Pool,
  jti: string
): Promise<{
  id: bigint;
  user_id: bigint;
  token_hash: string;
  expires_at: Date;
  revoked_at: Date | null;
} | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, user_id, token_hash, expires_at, revoked_at FROM refresh_tokens WHERE jti = ? LIMIT 1`,
    [jti]
  );
  if (!rows.length) return null;
  const r = rows[0];
  return {
    id: BigInt(r.id as number),
    user_id: BigInt(r.user_id as number),
    token_hash: String(r.token_hash),
    expires_at: new Date(r.expires_at as string),
    revoked_at: r.revoked_at ? new Date(r.revoked_at as string) : null,
  };
}

export async function revokeRefreshTokenByJti(pool: Pool, jti: string): Promise<void> {
  await pool.query(`UPDATE refresh_tokens SET revoked_at = NOW() WHERE jti = ? AND revoked_at IS NULL`, [jti]);
}

export async function revokeAllForUser(pool: Pool, userId: bigint): Promise<void> {
  await pool.query(`UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL`, [
    userId,
  ]);
}
