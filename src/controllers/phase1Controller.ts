import type { Response } from "express";
import type { Pool } from "mysql2/promise";
import type { ResultSetHeader } from "mysql2";
import * as announcementRepo from "../repositories/announcementRepository.js";
import * as bookingRepo from "../repositories/bookingRepository.js";
import * as eventMediaRepo from "../repositories/eventMediaRepository.js";
import * as eventRepo from "../repositories/eventRepository.js";
import * as exhibitorProfileRepo from "../repositories/exhibitorProfileRepository.js";
import * as organizerReadRepo from "../repositories/organizerReadRepository.js";
import * as paymentRepo from "../repositories/paymentRepository.js";
import * as stallRepo from "../repositories/stallRepository.js";
import * as stallHoldRepo from "../repositories/stallHoldRepository.js";
import * as ticketRepo from "../repositories/ticketOrderRepository.js";
import * as razorpay from "../services/razorpayService.js";
import { ensureInvoiceForPayment } from "../services/invoiceService.js";
import { sha256Hex, randomToken } from "../utils/crypto.js";
import { HttpError } from "../utils/httpError.js";
import type { AuthedRequest } from "../middlewares/authMiddleware.js";
import type { EventRow } from "../repositories/eventRepository.js";
import {
  announcementCreateSchema,
  createEventSchema,
  eventMediaCreateSchema,
  exhibitorBookingSchema,
  exhibitorProfileSchema,
  razorpayCreateOrderSchema,
  scanPayloadSchema,
  stallBulkCreateSchema,
  stallCreateSchema,
  stallStatusPatchSchema,
  stallTypeCreateSchema,
  ticketTypeCreateSchema,
  updateEventSchema,
  verifyRazorpaySchema,
  visitorTicketOrderSchema,
} from "../validators/phase1Schemas.js";

function pid(v: string | string[] | undefined): bigint {
  const s = Array.isArray(v) ? v[0] : v;
  if (!s) throw new HttpError(400, "Missing id");
  return BigInt(s);
}

function serializeEvent(e: EventRow) {
  let tags: string[] | null = null;
  if (e.tags != null) {
    tags = typeof e.tags === "string" ? (JSON.parse(e.tags) as string[]) : (e.tags as string[]);
  }
  return {
    id: String(e.id),
    organizerUserId: String(e.organizer_user_id),
    categoryId: e.category_id,
    title: e.title,
    description: e.description,
    venueName: e.venue_name,
    address: e.address,
    latitude: e.latitude != null ? Number(e.latitude) : null,
    longitude: e.longitude != null ? Number(e.longitude) : null,
    startsAt: e.starts_at,
    endsAt: e.ends_at,
    isB2b: Boolean(e.is_b2b),
    isB2c: Boolean(e.is_b2c),
    tags,
    status: e.status,
    publishedAt: e.published_at,
    createdAt: e.created_at,
    updatedAt: e.updated_at,
  };
}

export function createPhase1Controller(pool: Pool) {
  return {
    listPublicEvents: async (req: AuthedRequest, res: Response) => {
      const search = typeof req.query.search === "string" ? req.query.search : undefined;
      const categoryRaw = req.query.categoryId;
      const categoryId =
        typeof categoryRaw === "string" && categoryRaw.match(/^\d+$/) ? Number(categoryRaw) : undefined;
      const b2bOnly = req.query.b2b === "1" || req.query.b2b === "true";
      const b2cOnly = req.query.b2c === "1" || req.query.b2c === "true";
      const rows = await eventRepo.listPublishedEvents(pool, {
        search,
        categoryId,
        b2bOnly: b2bOnly || undefined,
        b2cOnly: b2cOnly || undefined,
      });
      res.json({ events: rows.map(serializeEvent) });
    },

    listPublicEventCategories: async (_req: AuthedRequest, res: Response) => {
      const categories = await eventRepo.listEventCategories(pool);
      res.json({ categories });
    },

    getPublicEvent: async (req: AuthedRequest, res: Response) => {
      const id = pid(req.params.eventId);
      const ev = await eventRepo.findEventById(pool, id);
      if (!ev || ev.status !== "published") throw new HttpError(404, "Event not found");
      const [media, announcements, ticketTypes] = await Promise.all([
        eventMediaRepo.listMediaForEvent(pool, id),
        announcementRepo.listAnnouncementsForEventPublic(pool, id, "visitor"),
        ticketRepo.listTicketTypesForEvent(pool, id),
      ]);
      res.json({
        event: serializeEvent(ev),
        media,
        announcements,
        ticketTypes: ticketTypes.map((t) => ({
          id: String(t.id),
          name: t.name,
          priceMinor: String(t.price_minor),
          quota: t.quota,
          soldCount: t.sold_count,
          currency: "INR",
        })),
      });
    },

    publicListTicketTypes: async (req: AuthedRequest, res: Response) => {
      const eventId = pid(req.params.eventId);
      const ev = await eventRepo.findEventById(pool, eventId);
      if (!ev || ev.status !== "published") throw new HttpError(404, "Event not found");
      const ticketTypes = await ticketRepo.listTicketTypesForEvent(pool, eventId);
      res.json({
        ticketTypes: ticketTypes.map((t) => ({
          id: String(t.id),
          name: t.name,
          priceMinor: String(t.price_minor),
          quota: t.quota,
          soldCount: t.sold_count,
          currency: "INR",
        })),
      });
    },

    organizerListEvents: async (req: AuthedRequest, res: Response) => {
      const rows = await eventRepo.listEventsForOrganizer(pool, req.userId!);
      res.json({ events: rows.map(serializeEvent) });
    },

    organizerGetEvent: async (req: AuthedRequest, res: Response) => {
      const eventId = pid(req.params.eventId);
      const ev = await eventRepo.findEventById(pool, eventId);
      if (!ev || ev.organizer_user_id !== req.userId!) throw new HttpError(404, "Event not found");
      res.json({ event: serializeEvent(ev) });
    },

    organizerCreateEvent: async (req: AuthedRequest, res: Response) => {
      const body = createEventSchema.parse(req.body);
      const id = await eventRepo.insertEvent(pool, {
        organizerUserId: req.userId!,
        categoryId: body.categoryId ?? null,
        title: body.title,
        description: body.description ?? null,
        venueName: body.venueName,
        address: body.address ?? null,
        latitude: body.latitude ?? null,
        longitude: body.longitude ?? null,
        startsAt: new Date(body.startsAt),
        endsAt: new Date(body.endsAt),
        isB2b: body.isB2b,
        isB2c: body.isB2c,
        tags: body.tags ?? null,
        status: body.status,
      });
      const ev = await eventRepo.findEventById(pool, id);
      res.status(201).json({ event: serializeEvent(ev!) });
    },

    organizerUpdateEvent: async (req: AuthedRequest, res: Response) => {
      const eventId = pid(req.params.eventId);
      const body = updateEventSchema.parse(req.body);
      const ok = await eventRepo.updateEvent(pool, eventId, req.userId!, {
        categoryId: body.categoryId,
        title: body.title,
        description: body.description,
        venueName: body.venueName,
        address: body.address,
        latitude: body.latitude,
        longitude: body.longitude,
        startsAt: body.startsAt ? new Date(body.startsAt) : undefined,
        endsAt: body.endsAt ? new Date(body.endsAt) : undefined,
        isB2b: body.isB2b,
        isB2c: body.isB2c,
        tags: body.tags,
        status: body.status,
      });
      if (!ok) throw new HttpError(404, "Event not found");
      const ev = await eventRepo.findEventById(pool, eventId);
      res.json({ event: serializeEvent(ev!) });
    },

    /** Plan-compat: explicit publish endpoint. */
    organizerPublishEvent: async (req: AuthedRequest, res: Response) => {
      const eventId = pid(req.params.eventId);
      const ev = await eventRepo.findEventById(pool, eventId);
      if (!ev || ev.organizer_user_id !== req.userId!) throw new HttpError(404, "Event not found");
      const ok = await eventRepo.updateEvent(pool, eventId, req.userId!, { status: "published" });
      if (!ok) throw new HttpError(404, "Event not found");
      const out = await eventRepo.findEventById(pool, eventId);
      res.json({ event: serializeEvent(out!) });
    },

    organizerDeleteEvent: async (req: AuthedRequest, res: Response) => {
      const eventId = pid(req.params.eventId);
      const ok = await eventRepo.deleteEventAsOrganizer(pool, eventId, req.userId!);
      if (!ok) throw new HttpError(404, "Event not found");
      res.status(204).send();
    },

    organizerListStallTypes: async (req: AuthedRequest, res: Response) => {
      const eventId = pid(req.params.eventId);
      const ev = await eventRepo.findEventById(pool, eventId);
      if (!ev || ev.organizer_user_id !== req.userId!) throw new HttpError(404, "Event not found");
      const rows = await stallRepo.listStallTypesForEvent(pool, eventId);
      res.json({
        stallTypes: rows.map((s) => ({
          id: String(s.id),
          code: s.code,
          name: s.name,
          priceMinor: String(s.price_minor),
          currency: s.currency,
        })),
      });
    },

    organizerCreateStallType: async (req: AuthedRequest, res: Response) => {
      const eventId = pid(req.params.eventId);
      const ev = await eventRepo.findEventById(pool, eventId);
      if (!ev || ev.organizer_user_id !== req.userId!) throw new HttpError(404, "Event not found");
      const body = stallTypeCreateSchema.parse(req.body);
      const id = await stallRepo.insertStallType(pool, {
        eventId,
        code: body.code,
        name: body.name,
        priceMinor: BigInt(body.priceMinor),
        currency: body.currency,
        description: body.description ?? null,
      });
      res.status(201).json({ id: String(id) });
    },

    organizerListStalls: async (req: AuthedRequest, res: Response) => {
      const eventId = pid(req.params.eventId);
      const ev = await eventRepo.findEventById(pool, eventId);
      if (!ev || ev.organizer_user_id !== req.userId!) throw new HttpError(404, "Event not found");
      const rows = await stallRepo.listStallsForEvent(pool, eventId);
      res.json({
        stalls: rows.map((s) => ({
          id: String(s.id),
          stallTypeId: String(s.stall_type_id),
          label: s.label,
          gridRow: s.grid_row,
          gridCol: s.grid_col,
          status: s.status,
        })),
      });
    },

    organizerCreateStall: async (req: AuthedRequest, res: Response) => {
      const eventId = pid(req.params.eventId);
      const ev = await eventRepo.findEventById(pool, eventId);
      if (!ev || ev.organizer_user_id !== req.userId!) throw new HttpError(404, "Event not found");
      const body = stallCreateSchema.parse(req.body);
      const id = await stallRepo.insertStall(pool, {
        eventId,
        stallTypeId: BigInt(body.stallTypeId),
        label: body.label,
        gridRow: body.gridRow ?? null,
        gridCol: body.gridCol ?? null,
      });
      res.status(201).json({ id: String(id) });
    },

    /** Plan-compat: bulk stall creation. */
    organizerCreateStallsBulk: async (req: AuthedRequest, res: Response) => {
      const eventId = pid(req.params.eventId);
      const ev = await eventRepo.findEventById(pool, eventId);
      if (!ev || ev.organizer_user_id !== req.userId!) throw new HttpError(404, "Event not found");
      const body = stallBulkCreateSchema.parse(req.body);
      const ids: string[] = [];
      for (const s of body.stalls) {
        const id = await stallRepo.insertStall(pool, {
          eventId,
          stallTypeId: BigInt(s.stallTypeId),
          label: s.label,
          gridRow: s.gridRow ?? null,
          gridCol: s.gridCol ?? null,
        });
        ids.push(String(id));
      }
      res.status(201).json({ ids });
    },

    organizerListTicketTypes: async (req: AuthedRequest, res: Response) => {
      const eventId = pid(req.params.eventId);
      const ev = await eventRepo.findEventById(pool, eventId);
      if (!ev || ev.organizer_user_id !== req.userId!) throw new HttpError(404, "Event not found");
      const rows = await ticketRepo.listTicketTypesForEvent(pool, eventId);
      res.json({ ticketTypes: rows });
    },

    organizerCreateTicketType: async (req: AuthedRequest, res: Response) => {
      const eventId = pid(req.params.eventId);
      const ev = await eventRepo.findEventById(pool, eventId);
      if (!ev || ev.organizer_user_id !== req.userId!) throw new HttpError(404, "Event not found");
      const body = ticketTypeCreateSchema.parse(req.body);
      const id = await ticketRepo.insertTicketType(pool, {
        eventId,
        name: body.name,
        priceMinor: BigInt(body.priceMinor),
        quota: body.quota,
      });
      res.status(201).json({ id: String(id) });
    },

    exhibitorCreateBooking: async (req: AuthedRequest, res: Response) => {
      const eventId = pid(req.params.eventId);
      const body = exhibitorBookingSchema.parse(req.body);
      const ev = await eventRepo.findEventById(pool, eventId);
      if (!ev || ev.status !== "published") throw new HttpError(404, "Event not found");

      const stallIds = body.stallIds.map((s) => BigInt(s));
      // Best-effort cleanup so expired holds don't block availability.
      await stallHoldRepo.releaseExpiredHolds(pool);
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        let subtotal = 0n;
        const linePrices: { stallId: bigint; unit: bigint }[] = [];

        for (const sid of stallIds) {
          const [rows] = await conn.query<import("mysql2").RowDataPacket[]>(
            `SELECT s.id, s.status, st.price_minor FROM stalls s
             INNER JOIN stall_types st ON st.id = s.stall_type_id
             WHERE s.id = ? AND s.event_id = ? FOR UPDATE`,
            [sid, eventId]
          );
          if (!rows.length) throw new HttpError(400, "Invalid stall");
          const st = rows[0];
          const status = String(st.status);
          if (status !== "available" && status !== "held") {
            throw new HttpError(409, `Stall ${sid} not available`);
          }

          if (status === "held") {
            // Allow booking only if held by this exhibitor and not expired.
            const [holds] = await conn.query<import("mysql2").RowDataPacket[]>(
              `SELECT holder_user_id, expires_at FROM stall_holds WHERE stall_id = ? ORDER BY expires_at DESC LIMIT 1 FOR UPDATE`,
              [sid]
            );
            if (!holds.length) throw new HttpError(409, `Stall ${sid} not available`);
            const h = holds[0];
            if (BigInt(h.holder_user_id as string) !== req.userId!) {
              throw new HttpError(409, `Stall ${sid} not available`);
            }
            const expiresAt = new Date(h.expires_at as string);
            if (!(expiresAt.getTime() > Date.now())) {
              throw new HttpError(409, `Stall ${sid} not available`);
            }
            // ok — keep status as held
          } else {
            // Mark held and create a hold record for this exhibitor (10 minutes).
            const [upd] = await conn.query<ResultSetHeader>(
              "UPDATE stalls SET status = 'held' WHERE id = ? AND event_id = ? AND status = 'available'",
              [sid, eventId]
            );
            if (upd.affectedRows !== 1) throw new HttpError(409, "Stall race — retry");
            await conn.query(
              "INSERT INTO stall_holds (stall_id, holder_user_id, expires_at) VALUES (?,?, DATE_ADD(NOW(), INTERVAL 10 MINUTE))",
              [sid, req.userId!]
            );
          }
          const unit = BigInt(st.price_minor as string);
          subtotal += unit;
          linePrices.push({ stallId: sid, unit });
        }

        const [br] = await conn.query<ResultSetHeader>(
          `INSERT INTO bookings (event_id, exhibitor_user_id, status, currency, subtotal_minor, razorpay_order_id)
           VALUES (?,?,?,?,?,?)`,
          [eventId, req.userId!, "pending", "INR", subtotal, null]
        );
        const bookingId = BigInt(br.insertId);
        for (const line of linePrices) {
          await conn.query(
            `INSERT INTO booking_items (booking_id, stall_id, unit_price_minor) VALUES (?,?,?)`,
            [bookingId, line.stallId, line.unit]
          );
        }

        let razorpayOrderId: string | null = null;
        if (subtotal > 0n) {
          const order = await razorpay.createOrder(Number(subtotal), "INR", `bk_${bookingId}`);
          razorpayOrderId = order.orderId;
          await conn.query("UPDATE bookings SET razorpay_order_id = ? WHERE id = ?", [
            razorpayOrderId,
            bookingId,
          ]);
        } else {
          await conn.query(
            "UPDATE bookings SET status = 'confirmed' WHERE id = ?",
            [bookingId]
          );
          for (const sid of stallIds) {
            await conn.query(
              "UPDATE stalls SET status = 'booked' WHERE id = ? AND event_id = ?",
              [sid, eventId]
            );
            await conn.query("DELETE FROM stall_holds WHERE stall_id = ?", [sid]);
          }
        }

        await conn.commit();
        res.status(201).json({
          bookingId: String(bookingId),
          subtotalMinor: String(subtotal),
          currency: "INR",
          razorpayOrderId,
          razorpayKeyId: process.env.RAZORPAY_KEY_ID ?? "",
        });
      } catch (e) {
        await conn.rollback();
        throw e;
      } finally {
        conn.release();
      }
    },

    exhibitorVerifyBooking: async (req: AuthedRequest, res: Response) => {
      const bookingId = pid(req.params.bookingId);
      const body = verifyRazorpaySchema.parse(req.body);
      const booking = await bookingRepo.findBookingForExhibitor(pool, bookingId, req.userId!);
      if (!booking) throw new HttpError(404, "Booking not found");
      if (booking.status !== "pending") throw new HttpError(400, "Booking not pending");
      if (booking.razorpay_order_id && booking.razorpay_order_id !== body.razorpayOrderId) {
        throw new HttpError(400, "Order id mismatch");
      }
      const ok = razorpay.verifyPaymentSignature(
        body.razorpayOrderId,
        body.razorpayPaymentId,
        body.razorpaySignature
      );
      if (!ok) throw new HttpError(400, "Invalid payment signature");

      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        await conn.query(
          "UPDATE bookings SET status = 'confirmed' WHERE id = ? AND exhibitor_user_id = ?",
          [bookingId, req.userId!]
        );
        const [items] = await conn.query<import("mysql2").RowDataPacket[]>(
          "SELECT stall_id FROM booking_items WHERE booking_id = ?",
          [bookingId]
        );
        for (const row of items) {
          await conn.query(
            "UPDATE stalls SET status = 'booked' WHERE id = ? AND event_id = ?",
            [row.stall_id, booking.event_id]
          );
          await conn.query("DELETE FROM stall_holds WHERE stall_id = ?", [row.stall_id]);
        }
        const [payIns] = await conn.query<ResultSetHeader>(
          `INSERT INTO payments (payer_user_id, amount_minor, currency, status, razorpay_order_id, razorpay_payment_id, booking_id, ticket_order_id)
           VALUES (?,?,?,?,?,?,?,?)`,
          [
            req.userId!,
            booking.subtotal_minor,
            "INR",
            "captured",
            body.razorpayOrderId,
            body.razorpayPaymentId,
            bookingId,
            null,
          ]
        );
        await conn.commit();
        await ensureInvoiceForPayment(pool, BigInt(payIns.insertId));
        res.json({ ok: true });
      } catch (e) {
        await conn.rollback();
        throw e;
      } finally {
        conn.release();
      }
    },

    visitorCreateTicketOrder: async (req: AuthedRequest, res: Response) => {
      const eventId = pid(req.params.eventId);
      const body = visitorTicketOrderSchema.parse(req.body);
      const ev = await eventRepo.findEventById(pool, eventId);
      if (!ev || ev.status !== "published") throw new HttpError(404, "Event not found");

      const ttId = BigInt(body.ticketTypeId);
      const tt = await ticketRepo.findTicketType(pool, ttId, eventId);
      if (!tt) throw new HttpError(404, "Ticket type not found");
      if (tt.sold_count + body.quantity > tt.quota) throw new HttpError(409, "Not enough quota");

      const total = tt.price_minor * BigInt(body.quantity);

      async function insertTicketsForOrder(
        conn: import("mysql2/promise").PoolConnection,
        orderId: bigint
      ): Promise<{ id: string; qrPayload: string }[]> {
        const ticketsOut: { id: string; qrPayload: string }[] = [];
        for (let i = 0; i < body.quantity; i++) {
          const [tr] = await conn.query<ResultSetHeader>(
            `INSERT INTO tickets (ticket_order_id, ticket_type_id, visitor_user_id, event_id, status)
             VALUES (?,?,?,?, 'unused')`,
            [orderId, ttId, req.userId!, eventId]
          );
          const ticketId = BigInt(tr.insertId);
          const raw = randomToken(16);
          const hash = sha256Hex(raw);
          await conn.query(
            `INSERT INTO qr_tokens (ticket_id, secret_hash, raw_secret) VALUES (?,?,?)`,
            [ticketId, hash, raw]
          );
          ticketsOut.push({
            id: String(ticketId),
            qrPayload: `TFW1.${ticketId}.${raw}`,
          });
        }
        return ticketsOut;
      }

      if (total === 0n) {
        const conn = await pool.getConnection();
        try {
          await conn.beginTransaction();
          const [upd] = await conn.query<ResultSetHeader>(
            "UPDATE ticket_types SET sold_count = sold_count + ? WHERE id = ? AND sold_count + ? <= quota",
            [body.quantity, ttId, body.quantity]
          );
          if (upd.affectedRows !== 1) throw new HttpError(409, "Quota exceeded");
          const [tor] = await conn.query<ResultSetHeader>(
            `INSERT INTO ticket_orders (event_id, visitor_user_id, ticket_type_id, quantity, status, currency, total_minor, razorpay_order_id)
             VALUES (?,?,?,?,?,?,?,?)`,
            [eventId, req.userId!, ttId, body.quantity, "paid", "INR", 0, null]
          );
          const orderId = BigInt(tor.insertId);
          const ticketsOut = await insertTicketsForOrder(conn, orderId);
          await conn.commit();
          res.status(201).json({
            ticketOrderId: String(orderId),
            totalMinor: "0",
            currency: "INR",
            razorpayOrderId: null,
            razorpayKeyId: process.env.RAZORPAY_KEY_ID ?? "",
            tickets: ticketsOut,
          });
        } catch (e) {
          await conn.rollback();
          throw e;
        } finally {
          conn.release();
        }
        return;
      }

      const [tor] = await pool.query<ResultSetHeader>(
        `INSERT INTO ticket_orders (event_id, visitor_user_id, ticket_type_id, quantity, status, currency, total_minor, razorpay_order_id)
         VALUES (?,?,?,?,?,?,?,?)`,
        [eventId, req.userId!, ttId, body.quantity, "pending", "INR", total, null]
      );
      const orderId = BigInt(tor.insertId);
      try {
        const rz = await razorpay.createOrder(Number(total), "INR", `to_${orderId}`);
        await pool.query("UPDATE ticket_orders SET razorpay_order_id = ? WHERE id = ?", [rz.orderId, orderId]);
        res.status(201).json({
          ticketOrderId: String(orderId),
          totalMinor: String(total),
          currency: "INR",
          razorpayOrderId: rz.orderId,
          razorpayKeyId: process.env.RAZORPAY_KEY_ID ?? "",
          tickets: [],
        });
      } catch (err) {
        await pool.query("DELETE FROM ticket_orders WHERE id = ?", [orderId]);
        throw err;
      }
    },

    visitorVerifyTicketOrder: async (req: AuthedRequest, res: Response) => {
      const orderId = pid(req.params.orderId);
      const body = verifyRazorpaySchema.parse(req.body);
      const order = await ticketRepo.findTicketOrder(pool, orderId, req.userId!);
      if (!order) throw new HttpError(404, "Order not found");
      if (order.status !== "pending") throw new HttpError(400, "Order not pending");
      if (order.total_minor === 0n) throw new HttpError(400, "Nothing to pay");
      if (order.razorpay_order_id && order.razorpay_order_id !== body.razorpayOrderId) {
        throw new HttpError(400, "Order id mismatch");
      }
      const ok = razorpay.verifyPaymentSignature(
        body.razorpayOrderId,
        body.razorpayPaymentId,
        body.razorpaySignature
      );
      if (!ok) throw new HttpError(400, "Invalid payment signature");

      const ttId = order.ticket_type_id;
      if (!ttId) throw new HttpError(500, "Order missing ticket type");

      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const [upd] = await conn.query<ResultSetHeader>(
          "UPDATE ticket_types SET sold_count = sold_count + ? WHERE id = ? AND sold_count + ? <= quota",
          [order.quantity, ttId, order.quantity]
        );
        if (upd.affectedRows !== 1) throw new HttpError(409, "Quota exceeded");

        const ticketsOut: { id: string; qrPayload: string }[] = [];
        for (let i = 0; i < order.quantity; i++) {
          const [tr] = await conn.query<ResultSetHeader>(
            `INSERT INTO tickets (ticket_order_id, ticket_type_id, visitor_user_id, event_id, status)
             VALUES (?,?,?,?, 'unused')`,
            [orderId, ttId, req.userId!, order.event_id]
          );
          const ticketId = BigInt(tr.insertId);
          const raw = randomToken(16);
          const hash = sha256Hex(raw);
          await conn.query(
            `INSERT INTO qr_tokens (ticket_id, secret_hash, raw_secret) VALUES (?,?,?)`,
            [ticketId, hash, raw]
          );
          ticketsOut.push({
            id: String(ticketId),
            qrPayload: `TFW1.${ticketId}.${raw}`,
          });
        }

        await conn.query(
          "UPDATE ticket_orders SET status = 'paid' WHERE id = ? AND visitor_user_id = ?",
          [orderId, req.userId!]
        );
        const [payIns] = await conn.query<ResultSetHeader>(
          `INSERT INTO payments (payer_user_id, amount_minor, currency, status, razorpay_order_id, razorpay_payment_id, booking_id, ticket_order_id)
           VALUES (?,?,?,?,?,?,?,?)`,
          [
            req.userId!,
            order.total_minor,
            "INR",
            "captured",
            body.razorpayOrderId,
            body.razorpayPaymentId,
            null,
            orderId,
          ]
        );
        await conn.commit();
        await ensureInvoiceForPayment(pool, BigInt(payIns.insertId));
        res.json({ ok: true, tickets: ticketsOut });
      } catch (e) {
        await conn.rollback();
        throw e;
      } finally {
        conn.release();
      }
    },

    visitorListTickets: async (req: AuthedRequest, res: Response) => {
      const rows = await ticketRepo.listTicketsForVisitor(pool, req.userId!);
      const enriched = await Promise.all(
        rows.map(async (t) => {
          const raw = await ticketRepo.getQrRawSecretForTicket(pool, BigInt(t.id), req.userId!);
          return {
            id: t.id,
            eventId: t.event_id,
            eventTitle: t.event_title,
            status: t.status,
            createdAt: t.created_at,
            qrPayload: raw ? `TFW1.${t.id}.${raw}` : null,
          };
        })
      );
      res.json({ tickets: enriched });
    },

    visitorListReceipts: async (req: AuthedRequest, res: Response) => {
      const rows = await paymentRepo.listPaymentsByPayer(pool, req.userId!);
      res.json({ receipts: rows });
    },

    organizerScanEntry: async (req: AuthedRequest, res: Response) => {
      const eventId = pid(req.params.eventId);
      const body = scanPayloadSchema.parse(req.body);
      const ev = await eventRepo.findEventById(pool, eventId);
      if (!ev || ev.organizer_user_id !== req.userId!) throw new HttpError(404, "Event not found");

      const parts = body.payload.trim().split(".");
      if (parts.length !== 3 || parts[0] !== "TFW1") throw new HttpError(400, "Invalid QR format");
      const ticketId = BigInt(parts[1]);
      const raw = parts[2];
      const hash = sha256Hex(raw);
      const row = await ticketRepo.findTicketByQrHash(pool, hash);
      if (!row) {
        throw new HttpError(400, "Invalid token");
      }
      if (row.event_id !== eventId) {
        await ticketRepo.insertEntryScan(pool, {
          ticketId: row.ticket_id,
          eventId,
          scannedByUserId: req.userId!,
          result: "wrong_event",
        });
        res.json({ result: "wrong_event" });
        return;
      }
      if (row.status !== "unused") {
        await ticketRepo.insertEntryScan(pool, {
          ticketId: row.ticket_id,
          eventId,
          scannedByUserId: req.userId!,
          result: "already_used",
        });
        res.json({ result: "already_used" });
        return;
      }
      const used = await ticketRepo.markTicketUsed(pool, row.ticket_id);
      if (!used) {
        await ticketRepo.insertEntryScan(pool, {
          ticketId: row.ticket_id,
          eventId,
          scannedByUserId: req.userId!,
          result: "already_used",
        });
        res.json({ result: "already_used" });
        return;
      }
      await ticketRepo.insertEntryScan(pool, {
        ticketId: row.ticket_id,
        eventId,
        scannedByUserId: req.userId!,
        result: "valid",
      });
      res.json({ result: "valid", ticketId: String(row.ticket_id) });
    },

    organizerListEventBookings: async (req: AuthedRequest, res: Response) => {
      const eventId = pid(req.params.eventId);
      const ev = await eventRepo.findEventById(pool, eventId);
      if (!ev || ev.organizer_user_id !== req.userId!) throw new HttpError(404, "Event not found");
      const bookings = await organizerReadRepo.listBookingsForEvent(pool, eventId);
      res.json({ bookings });
    },

    organizerListEventTickets: async (req: AuthedRequest, res: Response) => {
      const eventId = pid(req.params.eventId);
      const ev = await eventRepo.findEventById(pool, eventId);
      if (!ev || ev.organizer_user_id !== req.userId!) throw new HttpError(404, "Event not found");
      const tickets = await organizerReadRepo.listTicketsForEvent(pool, eventId);
      res.json({ tickets });
    },

    organizerListEventEntryScans: async (req: AuthedRequest, res: Response) => {
      const eventId = pid(req.params.eventId);
      const ev = await eventRepo.findEventById(pool, eventId);
      if (!ev || ev.organizer_user_id !== req.userId!) throw new HttpError(404, "Event not found");
      const scans = await organizerReadRepo.listEntryScansForEvent(pool, eventId);
      res.json({ scans });
    },

    /** Plan-compat alias of entry scans. */
    organizerListEventEntryLogs: async (req: AuthedRequest, res: Response) => {
      const eventId = pid(req.params.eventId);
      const ev = await eventRepo.findEventById(pool, eventId);
      if (!ev || ev.organizer_user_id !== req.userId!) throw new HttpError(404, "Event not found");
      const scans = await organizerReadRepo.listEntryScansForEvent(pool, eventId);
      res.json({ scans });
    },

    exhibitorEventCatalog: async (req: AuthedRequest, res: Response) => {
      const eventId = pid(req.params.eventId);
      const ev = await eventRepo.findEventById(pool, eventId);
      if (!ev || ev.status !== "published") throw new HttpError(404, "Event not found");
      await stallHoldRepo.releaseExpiredHolds(pool);
      const [stallTypes, stalls, media, announcements] = await Promise.all([
        stallRepo.listStallTypesForEvent(pool, eventId),
        stallRepo.listStallsForEvent(pool, eventId),
        eventMediaRepo.listMediaForEvent(pool, eventId),
        announcementRepo.listAnnouncementsForEventPublic(pool, eventId, "exhibitor"),
      ]);
      res.json({
        event: serializeEvent(ev),
        stallTypes: stallTypes.map((s) => ({
          id: String(s.id),
          code: s.code,
          name: s.name,
          priceMinor: String(s.price_minor),
          currency: s.currency,
        })),
        stalls: stalls.map((s) => ({
          id: String(s.id),
          stallTypeId: String(s.stall_type_id),
          label: s.label,
          gridRow: s.grid_row,
          gridCol: s.grid_col,
          status: s.status,
        })),
        media,
        announcements,
      });
    },

    /** Plan-compat: list exhibitor-visible events (same as public list). */
    exhibitorListEvents: async (req: AuthedRequest, res: Response) => {
      // Reuse public list; role check happens in routing.
      const search = typeof req.query.search === "string" ? req.query.search : undefined;
      const rows = await eventRepo.listPublishedEvents(pool, { search });
      res.json({ events: rows.map(serializeEvent) });
    },

    /** Plan-compat: list stalls for an event (exhibitor view). */
    exhibitorListEventStalls: async (req: AuthedRequest, res: Response) => {
      const eventId = pid(req.params.eventId);
      const ev = await eventRepo.findEventById(pool, eventId);
      if (!ev || ev.status !== "published") throw new HttpError(404, "Event not found");
      await stallHoldRepo.releaseExpiredHolds(pool);
      const stalls = await stallRepo.listStallsForEvent(pool, eventId);
      res.json({
        stalls: stalls.map((s) => ({
          id: String(s.id),
          stallTypeId: String(s.stall_type_id),
          label: s.label,
          gridRow: s.grid_row,
          gridCol: s.grid_col,
          status: s.status,
        })),
      });
    },

    /** Plan-compat: hold a stall for 10 minutes. */
    exhibitorHoldStall: async (req: AuthedRequest, res: Response) => {
      const stallId = pid(req.params.stallId);
      const result = await stallHoldRepo.holdStall(pool, {
        stallId,
        holderUserId: req.userId!,
        minutes: 10,
      });
      if (!result.ok) throw new HttpError(409, "Stall not available");
      res.json({ ok: true, expiresAt: result.expiresAt ?? null });
    },

    /** Plan-compat: generic Razorpay create order endpoint. */
    razorpayCreateOrder: async (req: AuthedRequest, res: Response) => {
      const body = razorpayCreateOrderSchema.parse(req.body);
      const order = await razorpay.createOrder(body.amountMinor, body.currency, body.receipt);
      res.status(201).json({ razorpayOrderId: order.orderId, razorpayKeyId: process.env.RAZORPAY_KEY_ID ?? "" });
    },

    /** Plan-compat: generic Razorpay verify signature endpoint. */
    razorpayVerifySignature: async (req: AuthedRequest, res: Response) => {
      const body = verifyRazorpaySchema.parse(req.body);
      const ok = razorpay.verifyPaymentSignature(body.razorpayOrderId, body.razorpayPaymentId, body.razorpaySignature);
      if (!ok) throw new HttpError(400, "Invalid payment signature");
      res.json({ ok: true });
    },

    exhibitorGetProfile: async (req: AuthedRequest, res: Response) => {
      const profile = await exhibitorProfileRepo.getExhibitorProfile(pool, req.userId!);
      res.json({ profile: profile ?? null });
    },

    exhibitorPatchProfile: async (req: AuthedRequest, res: Response) => {
      const body = exhibitorProfileSchema.parse(req.body);
      await exhibitorProfileRepo.upsertExhibitorProfile(pool, req.userId!, body);
      const profile = await exhibitorProfileRepo.getExhibitorProfile(pool, req.userId!);
      res.json({ profile });
    },

    exhibitorListPayments: async (req: AuthedRequest, res: Response) => {
      const rows = await paymentRepo.listPaymentsByPayer(pool, req.userId!);
      res.json({ payments: rows });
    },

    exhibitorRequestBookingRefund: async (req: AuthedRequest, res: Response) => {
      const bookingId = pid(req.params.bookingId);
      const ok = await bookingRepo.setBookingRefundRequested(pool, bookingId, req.userId!);
      if (!ok) throw new HttpError(400, "Cannot request refund (must be confirmed and not already requested)");
      res.json({ ok: true });
    },

    organizerListEventMedia: async (req: AuthedRequest, res: Response) => {
      const eventId = pid(req.params.eventId);
      const ev = await eventRepo.findEventById(pool, eventId);
      if (!ev || ev.organizer_user_id !== req.userId!) throw new HttpError(404, "Event not found");
      const media = await eventMediaRepo.listMediaForEvent(pool, eventId);
      res.json({ media });
    },

    organizerAddEventMedia: async (req: AuthedRequest, res: Response) => {
      const eventId = pid(req.params.eventId);
      const body = eventMediaCreateSchema.parse(req.body);
      const ev = await eventRepo.findEventById(pool, eventId);
      if (!ev || ev.organizer_user_id !== req.userId!) throw new HttpError(404, "Event not found");
      const id = await eventMediaRepo.insertEventMedia(pool, {
        eventId,
        url: body.url,
        mediaType: body.mediaType,
        sortOrder: body.sortOrder,
      });
      res.status(201).json({ id: String(id) });
    },

    organizerDeleteEventMedia: async (req: AuthedRequest, res: Response) => {
      const eventId = pid(req.params.eventId);
      const mediaId = pid(req.params.mediaId);
      const ev = await eventRepo.findEventById(pool, eventId);
      if (!ev || ev.organizer_user_id !== req.userId!) throw new HttpError(404, "Event not found");
      const ok = await eventMediaRepo.deleteEventMedia(pool, mediaId, eventId);
      if (!ok) throw new HttpError(404, "Media not found");
      res.status(204).send();
    },

    organizerListAnnouncements: async (req: AuthedRequest, res: Response) => {
      const eventId = pid(req.params.eventId);
      const ev = await eventRepo.findEventById(pool, eventId);
      if (!ev || ev.organizer_user_id !== req.userId!) throw new HttpError(404, "Event not found");
      const announcements = await announcementRepo.listAnnouncementsForOrganizer(pool, eventId);
      res.json({ announcements });
    },

    organizerCreateAnnouncement: async (req: AuthedRequest, res: Response) => {
      const eventId = pid(req.params.eventId);
      const body = announcementCreateSchema.parse(req.body);
      const ev = await eventRepo.findEventById(pool, eventId);
      if (!ev || ev.organizer_user_id !== req.userId!) throw new HttpError(404, "Event not found");
      const id = await announcementRepo.insertAnnouncement(pool, {
        eventId,
        createdByUserId: req.userId!,
        audience: body.audience,
        title: body.title,
        body: body.body,
      });
      res.status(201).json({ id: String(id) });
    },

    organizerPatchStall: async (req: AuthedRequest, res: Response) => {
      const eventId = pid(req.params.eventId);
      const stallId = pid(req.params.stallId);
      const body = stallStatusPatchSchema.parse(req.body);
      const ev = await eventRepo.findEventById(pool, eventId);
      if (!ev || ev.organizer_user_id !== req.userId!) throw new HttpError(404, "Event not found");
      const stall = await stallRepo.findStall(pool, stallId, eventId);
      if (!stall) throw new HttpError(404, "Stall not found");
      if (stall.status === "booked" && body.status !== "booked") {
        throw new HttpError(409, "Cannot change status of a booked stall from this endpoint");
      }
      const ok = await stallRepo.setStallStatus(pool, stallId, eventId, body.status);
      if (!ok) throw new HttpError(404, "Stall not found");
      res.json({ ok: true });
    },

    exhibitorListBookings: async (req: AuthedRequest, res: Response) => {
      const bookings = await bookingRepo.listBookingsForExhibitor(pool, req.userId!);
      res.json({ bookings });
    },
  };
}
