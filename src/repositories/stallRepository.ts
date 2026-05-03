import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

export type StallTypeRow = {
  id: bigint;
  event_id: bigint;
  code: string;
  name: string;
  price_minor: bigint;
  currency: string;
};

export type StallRow = {
  id: bigint;
  event_id: bigint;
  stall_type_id: bigint;
  label: string;
  grid_row: number | null;
  grid_col: number | null;
  status: "available" | "held" | "booked" | "blocked";
};

export async function insertStallType(
  pool: Pool,
  input: {
    eventId: bigint;
    code: string;
    name: string;
    priceMinor: bigint;
    currency: string;
    description: string | null;
  }
): Promise<bigint> {
  const [r] = await pool.query<ResultSetHeader>(
    `INSERT INTO stall_types (event_id, code, name, price_minor, currency, description)
     VALUES (?,?,?,?,?,?)`,
    [
      input.eventId,
      input.code,
      input.name,
      input.priceMinor,
      input.currency,
      input.description,
    ]
  );
  return BigInt(r.insertId);
}

export async function listStallTypesForEvent(pool: Pool, eventId: bigint): Promise<StallTypeRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id, event_id, code, name, price_minor, currency FROM stall_types WHERE event_id = ? ORDER BY id ASC",
    [eventId]
  );
  return rows.map((x) => ({
    ...x,
    id: BigInt(x.id as string),
    event_id: BigInt(x.event_id as string),
    price_minor: BigInt(x.price_minor as string),
  })) as StallTypeRow[];
}

export async function insertStall(
  pool: Pool,
  input: {
    eventId: bigint;
    stallTypeId: bigint;
    label: string;
    gridRow: number | null;
    gridCol: number | null;
    status?: StallRow["status"];
  }
): Promise<bigint> {
  const [r] = await pool.query<ResultSetHeader>(
    `INSERT INTO stalls (event_id, stall_type_id, label, grid_row, grid_col, status)
     VALUES (?,?,?,?,?,?)`,
    [
      input.eventId,
      input.stallTypeId,
      input.label,
      input.gridRow,
      input.gridCol,
      input.status ?? "available",
    ]
  );
  return BigInt(r.insertId);
}

export async function listStallsForEvent(pool: Pool, eventId: bigint): Promise<StallRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT * FROM stalls WHERE event_id = ? ORDER BY label ASC",
    [eventId]
  );
  return rows.map((x) => ({
    ...x,
    id: BigInt(x.id as string),
    event_id: BigInt(x.event_id as string),
    stall_type_id: BigInt(x.stall_type_id as string),
  })) as StallRow[];
}

export async function setStallStatus(
  pool: Pool,
  stallId: bigint,
  eventId: bigint,
  status: StallRow["status"]
): Promise<boolean> {
  const [r] = await pool.query<ResultSetHeader>(
    "UPDATE stalls SET status = ? WHERE id = ? AND event_id = ?",
    [status, stallId, eventId]
  );
  return r.affectedRows > 0;
}

export async function findStall(pool: Pool, stallId: bigint, eventId: bigint): Promise<StallRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT * FROM stalls WHERE id = ? AND event_id = ? LIMIT 1",
    [stallId, eventId]
  );
  if (!rows.length) return null;
  const x = rows[0];
  return {
    ...x,
    id: BigInt(x.id as string),
    event_id: BigInt(x.event_id as string),
    stall_type_id: BigInt(x.stall_type_id as string),
  } as StallRow;
}

export async function updateStallType(
  pool: Pool,
  eventId: bigint,
  typeId: bigint,
  patch: {
    code?: string;
    name?: string;
    price_minor?: bigint;
    currency?: string;
    description?: string | null;
  }
): Promise<boolean> {
  const parts: string[] = [];
  const vals: unknown[] = [];
  if (patch.code !== undefined) {
    parts.push("code = ?");
    vals.push(patch.code);
  }
  if (patch.name !== undefined) {
    parts.push("name = ?");
    vals.push(patch.name);
  }
  if (patch.price_minor !== undefined) {
    parts.push("price_minor = ?");
    vals.push(patch.price_minor);
  }
  if (patch.currency !== undefined) {
    parts.push("currency = ?");
    vals.push(patch.currency);
  }
  if (patch.description !== undefined) {
    parts.push("description = ?");
    vals.push(patch.description);
  }
  if (!parts.length) return true;
  vals.push(typeId, eventId);
  const [r] = await pool.query<ResultSetHeader>(
    `UPDATE stall_types SET ${parts.join(", ")} WHERE id = ? AND event_id = ?`,
    vals
  );
  return r.affectedRows > 0;
}

export async function deleteStallType(
  pool: Pool,
  eventId: bigint,
  typeId: bigint
): Promise<"deleted" | "not_found" | "in_use"> {
  const [cnt] = await pool.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM stalls WHERE stall_type_id = ? AND event_id = ?",
    [typeId, eventId]
  );
  if (Number(cnt[0]?.n ?? 0) > 0) return "in_use";
  const [r] = await pool.query<ResultSetHeader>(
    "DELETE FROM stall_types WHERE id = ? AND event_id = ?",
    [typeId, eventId]
  );
  return r.affectedRows > 0 ? "deleted" : "not_found";
}

export async function updateStallLayout(
  pool: Pool,
  eventId: bigint,
  stallId: bigint,
  patch: {
    label?: string;
    gridRow?: number | null;
    gridCol?: number | null;
    stallTypeId?: bigint;
  }
): Promise<boolean> {
  const parts: string[] = [];
  const vals: unknown[] = [];
  if (patch.label !== undefined) {
    parts.push("label = ?");
    vals.push(patch.label);
  }
  if (patch.gridRow !== undefined) {
    parts.push("grid_row = ?");
    vals.push(patch.gridRow);
  }
  if (patch.gridCol !== undefined) {
    parts.push("grid_col = ?");
    vals.push(patch.gridCol);
  }
  if (patch.stallTypeId !== undefined) {
    parts.push("stall_type_id = ?");
    vals.push(patch.stallTypeId);
  }
  if (!parts.length) return true;
  vals.push(stallId, eventId);
  const [r] = await pool.query<ResultSetHeader>(
    `UPDATE stalls SET ${parts.join(", ")} WHERE id = ? AND event_id = ?`,
    vals
  );
  return r.affectedRows > 0;
}

/** Removes an empty stall slot (not held or booked). */
export async function deleteStallIfUnused(
  pool: Pool,
  eventId: bigint,
  stallId: bigint
): Promise<"deleted" | "not_found" | "busy"> {
  const st = await findStall(pool, stallId, eventId);
  if (!st) return "not_found";
  if (st.status === "held" || st.status === "booked") return "busy";
  const [r] = await pool.query<ResultSetHeader>(
    "DELETE FROM stalls WHERE id = ? AND event_id = ? AND status IN ('available','blocked')",
    [stallId, eventId]
  );
  return r.affectedRows > 0 ? "deleted" : "busy";
}
