import type { Pool } from "mysql2/promise";
import type { ResultSetHeader } from "mysql2";
import type { RowDataPacket } from "mysql2";
import * as paymentRepo from "../repositories/paymentRepository.js";
import * as settingsRepo from "../repositories/settingsRepository.js";
import { randomToken, sha256Hex } from "../utils/crypto.js";
import { ensureInvoiceForPayment } from "./invoiceService.js";

async function calculateCommission(pool: Pool, amountMinor: bigint, type: "stall" | "ticket" | "service"): Promise<{ commissionMinor: bigint; gstMinor: bigint }> {
  const setting = await settingsRepo.getSetting(pool, "monetization_config");
  const config = setting?.value || { stall_commission_pct: 10, ticket_commission_pct: 10, service_commission_pct: 10 };
  
  let pct = 10;
  if (type === "stall") pct = Number(config.stall_commission_pct ?? 10);
  if (type === "ticket") pct = Number(config.ticket_commission_pct ?? 10);
  if (type === "service") pct = Number(config.service_commission_pct ?? 10);

  const commissionMinor = (amountMinor * BigInt(pct)) / 100n;
  const gstPct = Number(config.gst_pct ?? 18);
  const gstMinor = (commissionMinor * BigInt(gstPct)) / 100n;

  return { commissionMinor, gstMinor };
}

/** Idempotent: confirms exhibitor stall booking after Razorpay payment (manual verify or webhook). */
export async function finalizeBookingIfPending(pool: Pool, bookingId: bigint): Promise<boolean> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query<RowDataPacket[]>(
      "SELECT id, event_id, status, subtotal_minor, exhibitor_user_id FROM bookings WHERE id = ? FOR UPDATE",
      [bookingId]
    );
    if (!rows.length) {
      await conn.rollback();
      return false;
    }
    const b = rows[0];
    if (String(b.status) !== "pending") {
      await conn.rollback();
      return false;
    }

    await conn.query(
      "UPDATE bookings SET status = 'confirmed' WHERE id = ?",
      [bookingId]
    );
    const [items] = await conn.query<RowDataPacket[]>(
      "SELECT stall_id FROM booking_items WHERE booking_id = ?",
      [bookingId]
    );
    const eventId = BigInt(b.event_id as string);
    for (const row of items) {
      await conn.query(
        "UPDATE stalls SET status = 'booked' WHERE id = ? AND event_id = ?",
        [row.stall_id, eventId]
      );
      await conn.query("DELETE FROM stall_holds WHERE stall_id = ?", [row.stall_id]);
    }
    await conn.commit();
    return true;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

/** Record payment row for booking (call after finalizeBookingIfPending or together). */
export async function insertBookingPaymentRecord(
  pool: Pool,
  input: {
    payerUserId: bigint;
    amountMinor: bigint;
    razorpayOrderId: string;
    razorpayPaymentId: string;
    bookingId: bigint;
  }
): Promise<void> {
  const { commissionMinor, gstMinor } = await calculateCommission(pool, input.amountMinor, "stall");
  const paymentId = await paymentRepo.insertPayment(pool, {
    payerUserId: input.payerUserId,
    amountMinor: input.amountMinor,
    currency: "INR",
    status: "captured",
    razorpayOrderId: input.razorpayOrderId,
    razorpayPaymentId: input.razorpayPaymentId,
    bookingId: input.bookingId,
    ticketOrderId: null,
    serviceBookingId: null,
    metadata: { commissionMinor: String(commissionMinor), gstMinor: String(gstMinor) },
  });
  await ensureInvoiceForPayment(pool, paymentId);
}

/** Idempotent: fulfills visitor ticket order (paid path) after Razorpay. */
export async function finalizeTicketOrderIfPending(
  pool: Pool,
  orderId: bigint
): Promise<{ tickets: { id: string; qrPayload: string }[] } | null> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT id, event_id, visitor_user_id, status, total_minor, ticket_type_id, quantity
       FROM ticket_orders WHERE id = ? FOR UPDATE`,
      [orderId]
    );
    if (!rows.length) {
      await conn.rollback();
      return null;
    }
    const o = rows[0];
    if (String(o.status) !== "pending") {
      await conn.rollback();
      return null;
    }
    const totalMinor = BigInt(o.total_minor as string);
    if (totalMinor === 0n) {
      await conn.rollback();
      return null;
    }

    const ttId = o.ticket_type_id != null ? BigInt(o.ticket_type_id as string) : null;
    const visitorUserId = BigInt(o.visitor_user_id as string);
    const eventId = BigInt(o.event_id as string);
    const qty = Number(o.quantity ?? 1);
    if (!ttId) {
      await conn.rollback();
      return null;
    }

    const [upd] = await conn.query<ResultSetHeader>(
      "UPDATE ticket_types SET sold_count = sold_count + ? WHERE id = ? AND sold_count + ? <= quota",
      [qty, ttId, qty]
    );
    if (upd.affectedRows !== 1) {
      await conn.rollback();
      throw new Error("Quota exceeded for ticket order fulfillment");
    }

    const ticketsOut: { id: string; qrPayload: string }[] = [];
    for (let i = 0; i < qty; i++) {
      const [tr] = await conn.query<ResultSetHeader>(
        `INSERT INTO tickets (ticket_order_id, ticket_type_id, visitor_user_id, event_id, status)
         VALUES (?,?,?,?, 'unused')`,
        [orderId, ttId, visitorUserId, eventId]
      );
      const ticketId = BigInt(tr.insertId);
      const raw = randomToken(16);
      const hash = sha256Hex(raw);
      await conn.query(
        `INSERT INTO qr_tokens (ticket_id, secret_hash, raw_secret) VALUES (?,?,?)`,
        [ticketId, hash, raw]
      );
      ticketsOut.push({ id: String(ticketId), qrPayload: `TFW1.${ticketId}.${raw}` });
    }

    await conn.query("UPDATE ticket_orders SET status = 'paid' WHERE id = ?", [orderId]);
    await conn.commit();
    return { tickets: ticketsOut };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

export async function insertTicketOrderPaymentRecord(
  pool: Pool,
  input: {
    payerUserId: bigint;
    amountMinor: bigint;
    razorpayOrderId: string;
    razorpayPaymentId: string;
    ticketOrderId: bigint;
  }
): Promise<void> {
  const { commissionMinor, gstMinor } = await calculateCommission(pool, input.amountMinor, "ticket");
  const paymentId = await paymentRepo.insertPayment(pool, {
    payerUserId: input.payerUserId,
    amountMinor: input.amountMinor,
    currency: "INR",
    status: "captured",
    razorpayOrderId: input.razorpayOrderId,
    razorpayPaymentId: input.razorpayPaymentId,
    bookingId: null,
    ticketOrderId: input.ticketOrderId,
    serviceBookingId: null,
    metadata: { commissionMinor: String(commissionMinor), gstMinor: String(gstMinor) },
  });
  await ensureInvoiceForPayment(pool, paymentId);
}

export async function insertServiceBookingPaymentRecord(
  pool: Pool,
  input: {
    payerUserId: bigint;
    amountMinor: bigint;
    razorpayOrderId: string;
    razorpayPaymentId: string;
    serviceBookingId: bigint;
    metadata?: Record<string, unknown> | null;
  }
): Promise<void> {
  const { commissionMinor, gstMinor } = await calculateCommission(pool, input.amountMinor, "service");
  const paymentId = await paymentRepo.insertPayment(pool, {
    payerUserId: input.payerUserId,
    amountMinor: input.amountMinor,
    currency: "INR",
    status: "captured",
    razorpayOrderId: input.razorpayOrderId,
    razorpayPaymentId: input.razorpayPaymentId,
    bookingId: null,
    ticketOrderId: null,
    serviceBookingId: input.serviceBookingId,
    metadata: { ...input.metadata, commissionMinor: String(commissionMinor), gstMinor: String(gstMinor) },
  });
  await ensureInvoiceForPayment(pool, paymentId);
}
