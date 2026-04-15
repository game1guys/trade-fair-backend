import type { Pool, RowDataPacket } from "mysql2/promise";

export type ExhibitorProfileRow = {
  companyName: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  interests: string[] | null;
};

export async function getExhibitorProfile(pool: Pool, userId: bigint): Promise<ExhibitorProfileRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT company_name, city, state, country, interests FROM exhibitor_profiles WHERE user_id = ? LIMIT 1",
    [userId]
  );
  if (!rows.length) return null;
  const r = rows[0];
  let interests: string[] | null = null;
  if (r.interests != null) {
    interests =
      typeof r.interests === "string" ? (JSON.parse(r.interests) as string[]) : (r.interests as string[]);
  }
  return {
    companyName: r.company_name,
    city: r.city,
    state: r.state,
    country: r.country,
    interests,
  };
}

export async function upsertExhibitorProfile(
  pool: Pool,
  userId: bigint,
  patch: Partial<{
    companyName: string | null;
    city: string | null;
    state: string | null;
    country: string | null;
    interests: string[] | null;
  }>
): Promise<void> {
  const cur = await getExhibitorProfile(pool, userId);
  const companyName = patch.companyName !== undefined ? patch.companyName : cur?.companyName ?? null;
  const city = patch.city !== undefined ? patch.city : cur?.city ?? null;
  const state = patch.state !== undefined ? patch.state : cur?.state ?? null;
  const country = patch.country !== undefined ? patch.country : cur?.country ?? "India";
  const interests =
    patch.interests !== undefined ? patch.interests : cur?.interests ?? null;

  await pool.query(
    `INSERT INTO exhibitor_profiles (user_id, company_name, city, state, country, interests)
     VALUES (?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE
       company_name = VALUES(company_name),
       city = VALUES(city),
       state = VALUES(state),
       country = VALUES(country),
       interests = VALUES(interests)`,
    [
      userId,
      companyName,
      city,
      state,
      country,
      interests ? JSON.stringify(interests) : null,
    ]
  );
}
