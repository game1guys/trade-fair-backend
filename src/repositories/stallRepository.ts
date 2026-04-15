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
