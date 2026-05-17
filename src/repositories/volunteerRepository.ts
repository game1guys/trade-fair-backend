import type { Pool, ResultSetHeader } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";

export async function insertOrganizerVolunteer(
  pool: Pool,
  input: { organizerUserId: bigint; userId: bigint; fullName: string; phone: string; photoUrl?: string | null }
): Promise<bigint> {
  const [r] = await pool.query<ResultSetHeader>(
    `INSERT INTO organizer_volunteers (organizer_user_id, user_id, full_name, phone, photo_url)
     VALUES (?,?,?,?,?)`,
    [input.organizerUserId, input.userId, input.fullName, input.phone, input.photoUrl ?? null]
  );
  return BigInt(r.insertId);
}

export async function updateVolunteerPhoto(pool: Pool, volunteerId: bigint, organizerUserId: bigint, photoUrl: string) {
  const [r] = await pool.query<ResultSetHeader>(
    "UPDATE organizer_volunteers SET photo_url = ? WHERE id = ? AND organizer_user_id = ?",
    [photoUrl, volunteerId, organizerUserId]
  );
  return r.affectedRows > 0;
}

export async function findVolunteerForOrganizer(pool: Pool, volunteerId: bigint, organizerUserId: bigint) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT v.*, u.email AS login_email
     FROM organizer_volunteers v
     INNER JOIN users u ON u.id = v.user_id
     WHERE v.id = ? AND v.organizer_user_id = ?`,
    [volunteerId, organizerUserId]
  );
  return rows.length ? rows[0] : null;
}

export async function listOrganizerVolunteers(pool: Pool, organizerUserId: bigint) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT v.id, v.full_name, v.phone, v.photo_url, v.user_id, v.created_at, u.email AS login_email,
            (SELECT COUNT(*) FROM event_volunteer_assignments a WHERE a.volunteer_id = v.id) AS assignment_count
     FROM organizer_volunteers v
     INNER JOIN users u ON u.id = v.user_id
     WHERE v.organizer_user_id = ?
     ORDER BY v.full_name ASC`,
    [organizerUserId]
  );
  return rows;
}

export async function listEventVolunteers(pool: Pool, eventId: bigint, organizerUserId: bigint) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT v.id AS volunteer_id, v.full_name, v.phone, v.photo_url, v.user_id, u.email AS login_email,
            a.assigned_at, a.id AS assignment_id
     FROM event_volunteer_assignments a
     INNER JOIN organizer_volunteers v ON v.id = a.volunteer_id
     INNER JOIN users u ON u.id = v.user_id
     INNER JOIN events e ON e.id = a.event_id
     WHERE a.event_id = ? AND e.organizer_user_id = ?
     ORDER BY v.full_name ASC`,
    [eventId, organizerUserId]
  );
  return rows;
}

export async function assignVolunteerToEvent(pool: Pool, eventId: bigint, volunteerId: bigint): Promise<boolean> {
  try {
    const [r] = await pool.query<ResultSetHeader>(
      "INSERT INTO event_volunteer_assignments (event_id, volunteer_id) VALUES (?,?)",
      [eventId, volunteerId]
    );
    return r.affectedRows > 0;
  } catch (e: unknown) {
    const err = e as { code?: string };
    if (err.code === "ER_DUP_ENTRY") return true;
    throw e;
  }
}

export async function unassignVolunteerFromEvent(
  pool: Pool,
  eventId: bigint,
  volunteerId: bigint,
  organizerUserId: bigint
): Promise<boolean> {
  const [r] = await pool.query<ResultSetHeader>(
    `DELETE a FROM event_volunteer_assignments a
     INNER JOIN events e ON e.id = a.event_id
     INNER JOIN organizer_volunteers v ON v.id = a.volunteer_id
     WHERE a.event_id = ? AND a.volunteer_id = ? AND e.organizer_user_id = ? AND v.organizer_user_id = ?`,
    [eventId, volunteerId, organizerUserId, organizerUserId]
  );
  return r.affectedRows > 0;
}

export async function isVolunteerAssignedToEvent(pool: Pool, eventId: bigint, userId: bigint): Promise<boolean> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT 1 FROM event_volunteer_assignments a
     INNER JOIN organizer_volunteers v ON v.id = a.volunteer_id
     WHERE a.event_id = ? AND v.user_id = ? LIMIT 1`,
    [eventId, userId]
  );
  return rows.length > 0;
}

export async function listVolunteerEventsForUser(pool: Pool, userId: bigint) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT e.id AS event_id, e.title, e.venue_name, e.venue_city, e.starts_at, e.ends_at, e.status,
            e.entry_qr_allow_reentry, v.full_name AS volunteer_name, a.assigned_at
     FROM event_volunteer_assignments a
     INNER JOIN organizer_volunteers v ON v.id = a.volunteer_id
     INNER JOIN events e ON e.id = a.event_id
     WHERE v.user_id = ?
     ORDER BY e.starts_at DESC`,
    [userId]
  );
  return rows;
}

export async function findVolunteerProfileByUserId(pool: Pool, userId: bigint) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT v.id, v.full_name, v.phone, v.photo_url, v.organizer_user_id
     FROM organizer_volunteers v WHERE v.user_id = ? LIMIT 1`,
    [userId]
  );
  return rows.length ? rows[0] : null;
}
