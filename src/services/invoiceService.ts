import type { Pool } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";

/** Creates a row in `invoices` if missing; returns invoice number. */
export async function ensureInvoiceForPayment(pool: Pool, paymentId: bigint): Promise<string> {
  const [existing] = await pool.query<RowDataPacket[]>(
    "SELECT invoice_number FROM invoices WHERE payment_id = ? LIMIT 1",
    [paymentId]
  );
  if (existing.length) return String(existing[0].invoice_number);

  const year = new Date().getFullYear();
  const invoiceNumber = `INV-${year}-${String(paymentId).padStart(8, "0")}`;
  await pool.query(`INSERT INTO invoices (payment_id, invoice_number) VALUES (?, ?)`, [
    paymentId,
    invoiceNumber,
  ]);
  return invoiceNumber;
}
