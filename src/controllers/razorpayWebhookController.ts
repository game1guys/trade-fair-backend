import type { Request, Response } from "express";
import type { Pool } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import * as bookingRepo from "../repositories/bookingRepository.js";
import * as marketplaceRepo from "../repositories/marketplaceRepository.js";
import * as ticketRepo from "../repositories/ticketOrderRepository.js";
import * as finalize from "../services/paymentFinalizeService.js";
import { verifyWebhookSignature } from "../services/razorpayService.js";

type RzBody = {
  event?: string;
  payload?: {
    payment?: { entity?: { id?: string; order_id?: string; status?: string } };
  };
};

async function paymentExists(pool: Pool, razorpayPaymentId: string): Promise<boolean> {
  const [r] = await pool.query<RowDataPacket[]>(
    "SELECT id FROM payments WHERE razorpay_payment_id = ? LIMIT 1",
    [razorpayPaymentId]
  );
  return r.length > 0;
}

export function createRazorpayWebhookHandler(pool: Pool) {
  return async (req: Request & { rawBody?: Buffer }, res: Response) => {
    const raw = req.rawBody?.toString("utf8") ?? "";
    const h = req.headers["x-razorpay-signature"];
    const sig = Array.isArray(h) ? h[0] : h;
    if (!verifyWebhookSignature(raw, sig)) {
      return res.status(400).json({ error: "Invalid signature" });
    }

    const body = req.body as RzBody;
    if (body.event !== "payment.captured") {
      return res.json({ ok: true, ignored: true });
    }

    const pay = body.payload?.payment?.entity;
    const paymentId = pay?.id;
    const orderId = pay?.order_id;
    if (!paymentId || !orderId) {
      return res.json({ ok: true, ignored: true });
    }

    if (await paymentExists(pool, paymentId)) {
      return res.json({ ok: true, duplicate: true });
    }

    const booking = await bookingRepo.findBookingByRazorpayOrderId(pool, orderId);
    if (booking && booking.status === "pending") {
      const ok = await finalize.finalizeBookingIfPending(pool, booking.id);
      if (ok) {
        await finalize.insertBookingPaymentRecord(pool, {
          payerUserId: booking.exhibitor_user_id,
          amountMinor: booking.subtotal_minor,
          razorpayOrderId: orderId,
          razorpayPaymentId: paymentId,
          bookingId: booking.id,
          eventId: booking.event_id,
        });
      }
      return res.json({ ok: true, type: "booking" });
    }

    const tOrder = await ticketRepo.findTicketOrderByRazorpayOrderId(pool, orderId);
    if (tOrder && tOrder.status === "pending") {
      const result = await finalize.finalizeTicketOrderIfPending(pool, tOrder.id);
      if (result) {
        await finalize.insertTicketOrderPaymentRecord(pool, {
          payerUserId: tOrder.visitor_user_id,
          amountMinor: tOrder.total_minor,
          razorpayOrderId: orderId,
          razorpayPaymentId: paymentId,
          ticketOrderId: tOrder.id,
        });
      }
      return res.json({ ok: true, type: "ticket_order" });
    }

    const svcBooking = await marketplaceRepo.findServiceBookingByRazorpayOrderId(pool, orderId);
    if (svcBooking && String(svcBooking.status) === "pending_payment") {
      const bookingId = BigInt(String(svcBooking.id));
      const ok = await marketplaceRepo.confirmServiceBookingPayment(pool, bookingId);
      if (ok) {
        await finalize.insertServiceBookingPaymentRecord(pool, {
          payerUserId: BigInt(String(svcBooking.customer_user_id)),
          amountMinor: BigInt(String(svcBooking.amount_minor)),
          razorpayOrderId: orderId,
          razorpayPaymentId: paymentId,
          serviceBookingId: bookingId,
          metadata: { source: "webhook" },
        });
      }
      return res.json({ ok: true, type: "service_booking" });
    }

    return res.json({ ok: true, nothing: true });
  };
}
