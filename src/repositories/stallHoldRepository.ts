import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

export async function releaseExpiredHolds(pool: Pool): Promise<void> {
  // Release any holds that expired, and mark those stalls available again.
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT stall_id FROM stall_holds WHERE expires_at <= NOW()"
  );
  if (!rows.length) return;
  const stallIds = rows.map((r) => BigInt(r.stall_id as string));
  await pool.query("DELETE FROM stall_holds WHERE expires_at <= NOW()");
  // Only flip stalls still held (avoid overriding booked/blocked).
  for (const sid of stallIds) {
    await pool.query("UPDATE stalls SET status = 'available' WHERE id = ? AND status = 'held'", [sid]);
  }
}

export async function holdStall(
  pool: Pool,
  input: { stallId: bigint; holderUserId: bigint; minutes: number }
): Promise<{ ok: boolean; expiresAt?: Date }> {
  // Best-effort cleanup so holds don't accumulate.
  await releaseExpiredHolds(pool);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query<RowDataPacket[]>(
      "SELECT id, status FROM stalls WHERE id = ? FOR UPDATE",
      [input.stallId]
    );
    if (!rows.length) {
      await conn.rollback();
      return { ok: false };
    }
    const s = rows[0];
    if (String(s.status) !== "available") {
      await conn.rollback();
      return { ok: false };
    }
    const [upd] = await conn.query<ResultSetHeader>(
      "UPDATE stalls SET status = 'held' WHERE id = ? AND status = 'available'",
      [input.stallId]
    );
    if (upd.affectedRows !== 1) {
      await conn.rollback();
      return { ok: false };
    }
    const [ins] = await conn.query<ResultSetHeader>(
      "INSERT INTO stall_holds (stall_id, holder_user_id, expires_at) VALUES (?,?, DATE_ADD(NOW(), INTERVAL ? MINUTE))",
      [input.stallId, input.holderUserId, input.minutes]
    );
    // Fetch expires_at
    const [exp] = await conn.query<RowDataPacket[]>(
      "SELECT expires_at FROM stall_holds WHERE id = ? LIMIT 1",
      [ins.insertId]
    );
    await conn.commit();
    return { ok: true, expiresAt: exp.length ? (exp[0].expires_at as Date) : undefined };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

