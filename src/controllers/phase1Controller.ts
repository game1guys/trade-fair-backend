import type { Response } from "express";
import type { Pool } from "mysql2/promise";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import * as announcementRepo from "../repositories/announcementRepository.js";
import * as bookingRepo from "../repositories/bookingRepository.js";
import * as eventMediaRepo from "../repositories/eventMediaRepository.js";
import * as eventRepo from "../repositories/eventRepository.js";
import * as eventCatRepo from "../repositories/eventCategoryRepository.js";
import * as exhibitorProfileRepo from "../repositories/exhibitorProfileRepository.js";
import * as exhibitorFavoriteRepo from "../repositories/exhibitorFavoriteRepository.js";
import * as organizerReadRepo from "../repositories/organizerReadRepository.js";
import * as paymentRepo from "../repositories/paymentRepository.js";
import * as stallRepo from "../repositories/stallRepository.js";
import * as stallHoldRepo from "../repositories/stallHoldRepository.js";
import * as ticketRepo from "../repositories/ticketOrderRepository.js";
import * as userRepo from "../repositories/userRepository.js";
import * as moderationRepo from "../repositories/moderationRepository.js";
import * as marketplaceRepo from "../repositories/marketplaceRepository.js";
import * as eventReminderRepo from "../repositories/eventReminderRepository.js";
import * as organizerCommRepo from "../repositories/organizerCommunicationRepository.js";
import * as organizerPayoutRepo from "../repositories/organizerPayoutRepository.js";
import * as organizerRouteOnboarding from "../services/organizerRouteOnboardingService.js";
import * as razorpay from "../services/razorpayService.js";
import * as subscriptionAccess from "../services/subscriptionAccessService.js";
import { ensureInvoiceForPayment } from "../services/invoiceService.js";
import { insertBookingPaymentRecord, insertTicketOrderPaymentRecord } from "../services/paymentFinalizeService.js";
import { sha256Hex, randomToken } from "../utils/crypto.js";
import { HttpError } from "../utils/httpError.js";
import { marketplaceDealStage } from "../utils/marketplaceDealStage.js";
import { verifyAccessToken } from "../utils/jwt.js";
import { allowDemoVisitorTickets, env } from "../config/env.js";
import { z } from "zod";
import { emitGateScan, subscribeGateScan } from "../realtime/gateBus.js";
import { sendSmtpEmail, sendWhatsAppCloud } from "../services/outboundMessaging.js";
import {
  emailLater,
  notifyStallBookingConfirmed,
  notifyTicketOrderConfirmed,
} from "../services/transactionalEmail.js";
import type { AuthedRequest } from "../middlewares/authMiddleware.js";
import type { EventRow } from "../repositories/eventRepository.js";
import {
  announcementCreateSchema,
  announcementPatchSchema,
  createEventSchema,
  eventMediaCreateSchema,
  eventReminderCreateSchema,
  eventReminderPatchSchema,
  exhibitorBookingSchema,
  organizerBookingReassignSchema,
  exhibitorProfileSchema,
  organizerBulkCommunicationSchema,
  organizerPayoutProfilePutSchema,
  razorpayCreateOrderSchema,
  scanPayloadSchema,
  stallBulkCreateSchema,
  stallCreateSchema,
  stallOrganizerPatchSchema,
  stallTypeCreateSchema,
  stallTypeUpdateSchema,
  ticketTypeCreateSchema,
  ticketTypeUpdateSchema,
  updateEventSchema,
  verifyRazorpaySchema,
  visitorTicketOrderSchema,
} from "../validators/phase1Schemas.js";

function pid(v: string | string[] | undefined): bigint {
  const s = Array.isArray(v) ? v[0] : v;
  if (!s) throw new HttpError(400, "Missing id");
  return BigInt(s);
}

const DEMO_FAIR_TITLE = "Demo Fair (local)";

async function findPublishedFreeZeroTicket(
  pool: Pool
): Promise<{ eventId: bigint; ticketTypeId: bigint } | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT e.id AS event_id, tt.id AS ticket_type_id
     FROM events e
     INNER JOIN ticket_types tt ON tt.event_id = e.id
     WHERE e.status = 'published'
       AND tt.price_minor = 0
       AND tt.sold_count < tt.quota
     ORDER BY e.id ASC, tt.id ASC
     LIMIT 1`
  );
  if (!rows.length) return null;
  return {
    eventId: BigInt(rows[0].event_id as string),
    ticketTypeId: BigInt(rows[0].ticket_type_id as string),
  };
}

async function ensureDemoFairForQrDemo(pool: Pool): Promise<{ eventId: bigint; ticketTypeId: bigint }> {
  const found = await findPublishedFreeZeroTicket(pool);
  if (found) return found;

  const [users] = await pool.query<RowDataPacket[]>("SELECT id FROM users ORDER BY id ASC LIMIT 1");
  if (!users.length) throw new HttpError(500, "No users in database");

  const orgId = BigInt(users[0].id as string);
  const startsAt = new Date();
  startsAt.setDate(startsAt.getDate() + 1);
  const endsAt = new Date();
  endsAt.setMonth(endsAt.getMonth() + 1);

  const eventId = await eventRepo.insertEvent(pool, {
    organizerUserId: orgId,
    categoryId: null,
    title: DEMO_FAIR_TITLE,
    description: "Auto-created so you can try QR passes locally.",
    venueName: "Demo venue",
    venueCity: null,
    venueCountry: null,
    venueState: null,
    address: null,
    latitude: null,
    longitude: null,
    startsAt,
    endsAt,
    isB2b: true,
    isB2c: true,
    tags: null,
    status: "published",
  });

  const ticketTypeId = await ticketRepo.insertTicketType(pool, {
    eventId,
    name: "General (demo)",
    priceMinor: 0n,
    quota: 1000,
  });

  return { eventId, ticketTypeId };
}

function serializeEvent(e: EventRow) {
  let tags: string[] | null = null;
  if (e.tags != null) {
    try {
      tags = typeof e.tags === "string" ? (JSON.parse(e.tags) as string[]) : (e.tags as string[]);
    } catch {
      tags = null;
    }
  }
  return {
    id: String(e.id),
    organizerUserId: String(e.organizer_user_id),
    categoryId: e.category_id,
    title: e.title,
    description: e.description,
    venueName: e.venue_name,
    venueCity: e.venue_city,
    venueCountry: e.venue_country,
    venueState: e.venue_state ?? null,
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
    requireBookingApproval: Boolean((e as EventRow).require_booking_approval),
    entryQrAllowReentry: Boolean((e as EventRow).entry_qr_allow_reentry),
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
      const venueCity = typeof req.query.venueCity === "string" ? req.query.venueCity : undefined;
      const venueState = typeof req.query.venueState === "string" ? req.query.venueState : undefined;
      const dateFrom = typeof req.query.dateFrom === "string" ? req.query.dateFrom : undefined;
      const dateTo = typeof req.query.dateTo === "string" ? req.query.dateTo : undefined;
      const rows = await eventRepo.listPublishedEventsWithCover(pool, {
        search,
        categoryId,
        b2bOnly: b2bOnly || undefined,
        b2cOnly: b2cOnly || undefined,
        venueCity,
        venueState,
        dateFrom,
        dateTo,
      });
      res.json({
        events: rows.map(({ event, coverImageUrl }) => ({
          ...serializeEvent(event),
          coverImageUrl,
        })),
      });
    },

    listPublicEventCategories: async (_req: AuthedRequest, res: Response) => {
      const categories = await eventRepo.listEventCategories(pool);
      const [counts] = await pool.query<RowDataPacket[]>(
        `SELECT category_id, COUNT(*) AS total FROM events WHERE status = 'published' GROUP BY category_id`
      );
      const mapped = categories.map((c) => ({
        ...c,
        eventCount: counts.find((x) => x.category_id === c.id)?.total ?? 0,
      }));
      res.json({ categories: mapped });
    },

    getPublicEvent: async (req: AuthedRequest, res: Response) => {
      const id = pid(req.params.eventId);
      const ev = await eventRepo.findEventById(pool, id);
      if (!ev || ev.status !== "published") throw new HttpError(404, "Event not found");
      const [media, announcements, ticketTypes, reviews] = await Promise.all([
        eventMediaRepo.listMediaForEvent(pool, id),
        announcementRepo.listAnnouncementsForEventPublic(pool, id, "visitor"),
        ticketRepo.listTicketTypesForEvent(pool, id),
        eventRepo.listReviewsForEvent(pool, id),
      ]);
      const categoryIds = await eventCatRepo.listCategoryIdsForEvent(pool, id);
      const mergedCats = categoryIds.length ? categoryIds : ev.category_id != null ? [ev.category_id] : [];
      res.json({
        event: { ...serializeEvent(ev), categoryIds: mergedCats },
        media,
        announcements,
        reviews,
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

    submitEventReview: async (req: AuthedRequest, res: Response) => {
      const eventId = pid(req.params.eventId);
      const { rating, comment } = z
        .object({
          rating: z.number().min(1).max(5),
          comment: z.string().max(1000).optional().nullable(),
        })
        .parse(req.body);

      const event = await eventRepo.findEventById(pool, eventId);
      if (!event || String(event.status) !== "published") throw new HttpError(404, "Event not found");
      const eventEnd = event.ends_at ? new Date(event.ends_at) : new Date(event.starts_at);
      if (eventEnd.getTime() > Date.now()) {
        throw new HttpError(400, "Reviews are only available after the event has ended");
      }

      // Check if user has a ticket for this event
      const [tickets] = await pool.query<RowDataPacket[]>(
        "SELECT id FROM tickets WHERE event_id = ? AND visitor_user_id = ? LIMIT 1",
        [eventId, req.userId!]
      );
      if (!tickets.length) throw new HttpError(403, "Only visitors with tickets can review events");

      const id = await eventRepo.insertEventReview(pool, {
        eventId,
        reviewerUserId: req.userId!,
        rating,
        comment: comment ?? null,
      });
      res.json({ id: String(id) });
    },

    organizerListEvents: async (req: AuthedRequest, res: Response) => {
      const rows = await eventRepo.listEventsForOrganizerWithCover(pool, req.userId!);
      const ids = rows.map((r) => r.event.id);
      const catMap = await eventCatRepo.listCategoryIdsForEvents(pool, ids);
      res.json({
        events: rows.map(({ event, coverImageUrl }) => {
          const links = catMap.get(String(event.id));
          const categoryIds =
            links && links.length ? links : event.category_id != null ? [event.category_id] : [];
          return {
            ...serializeEvent(event),
            coverImageUrl,
            categoryIds,
          };
        }),
      });
    },

    organizerGetEvent: async (req: AuthedRequest, res: Response) => {
      const eventId = pid(req.params.eventId);
      const ev = await eventRepo.findEventById(pool, eventId);
      if (!ev || ev.organizer_user_id !== req.userId!) throw new HttpError(404, "Event not found");
      const categoryIds = await eventCatRepo.listCategoryIdsForEvent(pool, eventId);
      const merged = categoryIds.length ? categoryIds : ev.category_id != null ? [ev.category_id] : [];
      res.json({ event: { ...serializeEvent(ev), categoryIds: merged } });
    },

    /** Enquiries & bookings for this fair (organizer as customer). */
    organizerListEventMarketplaceDeals: async (req: AuthedRequest, res: Response) => {
      const eventId = pid(req.params.eventId);
      const ev = await eventRepo.findEventById(pool, eventId);
      if (!ev || ev.organizer_user_id !== req.userId!) throw new HttpError(404, "Event not found");
      const rows = await marketplaceRepo.listEventMarketplaceDeals(pool, eventId, req.userId!);
      res.json({
        deals: rows.map((r) => {
          const bookingStatus = r.booking_status != null ? String(r.booking_status) : null;
          const requestStatus = String(r.request_status);
          return {
            requestId: String(r.request_id),
            requestStatus,
            enquiryCreatedAt: r.enquiry_created_at,
            messagePreview:
              String(r.message).length > 120 ? `${String(r.message).slice(0, 117)}…` : String(r.message),
            bookingId: r.booking_id != null ? String(r.booking_id) : null,
            bookingStatus,
            bookingUpdatedAt: r.booking_updated_at ?? null,
            amountMinor: r.amount_minor != null ? String(r.amount_minor) : null,
            currency: r.currency != null ? String(r.currency) : null,
            serviceId: String(r.service_id),
            serviceTitle: String(r.service_title),
            providerUserId: String(r.provider_user_id),
            providerDisplayName: String(r.provider_display_name),
            dealStage: marketplaceDealStage({
              contractStatus: r.contract_status,
              bookingStatus,
              requestStatus,
            }),
            contractStatus: r.contract_status != null ? String(r.contract_status) : null,
            contractAcceptedAt: r.contract_accepted_at ?? null,
            contractServiceDescription:
              r.contract_service_description != null ? String(r.contract_service_description) : null,
            contractDurationDays:
              r.contract_duration_days != null ? Number(r.contract_duration_days) : null,
            contractPeopleCount: r.contract_people_count != null ? Number(r.contract_people_count) : null,
            contractManpowerAvailable:
              r.contract_manpower_available != null ? Number(r.contract_manpower_available) : null,
            contextEventTitle: r.context_event_title != null ? String(r.context_event_title) : null,
            contextEventVenue: r.context_event_venue != null ? String(r.context_event_venue) : null,
            contextEventStartsAt: r.context_event_starts_at ?? null,
            contextEventEndsAt: r.context_event_ends_at ?? null,
          };
        }),
      });
    },

    /** Published marketplace listings scoped for organizers managing one fair — attach enquiries via POST marketplace … + eventId. */
    organizerListMarketplaceServicesForEvent: async (req: AuthedRequest, res: Response) => {
      const eventId = pid(req.params.eventId);
      const ev = await eventRepo.findEventById(pool, eventId);
      if (!ev || ev.organizer_user_id !== req.userId!) throw new HttpError(404, "Event not found");
      const categoryId =
        typeof req.query.categoryId === "string" && req.query.categoryId.match(/^\d+$/)
          ? Number(req.query.categoryId)
          : undefined;
      const search = typeof req.query.search === "string" ? req.query.search : undefined;
      const rows = await marketplaceRepo.listPublishedServices(pool, { categoryId, search });
      res.json({
        event: {
          id: String(ev.id),
          title: ev.title,
          venueName: ev.venue_name,
          venueCity: ev.venue_city ?? null,
          startsAt: ev.starts_at,
          endsAt: ev.ends_at,
          status: ev.status,
        },
        services: rows.map((r) => ({
          id: String(r.id),
          categoryId: Number(r.category_id),
          title: String(r.title),
          description:
            r.description != null ? (String(r.description).length > 400 ? `${String(r.description).slice(0, 397)}…` : String(r.description)) : null,
          priceMinor: String(r.price_minor),
          currency: String(r.currency),
          categoryName: String(r.category_name),
          companyName: r.company_name != null ? String(r.company_name) : null,
          coverImageUrl: r.cover_image_url != null ? String(r.cover_image_url) : null,
          imageUrls: marketplaceRepo.parseServiceImageUrls(r.image_urls),
          serviceArea: r.service_area != null ? String(r.service_area) : null,
          leadTimeDays: r.lead_time_days != null ? Number(r.lead_time_days) : null,
          yearsInBusiness: r.years_in_business != null ? Number(r.years_in_business) : null,
          organizerRatingAvg: r.organizer_rating_avg != null ? Number(r.organizer_rating_avg) : null,
          organizerRatingCount:
            r.organizer_rating_count != null ? Number(r.organizer_rating_count) : 0,
          deliveryNotes:
            r.delivery_notes != null
              ? String(r.delivery_notes).length > 220
                ? `${String(r.delivery_notes).slice(0, 217)}…`
                : String(r.delivery_notes)
              : null,
        })),
      });
    },

    organizerCreateEvent: async (req: AuthedRequest, res: Response) => {
      const body = createEventSchema.parse(req.body);
      await subscriptionAccess.assertOrganizerCanCreateEvent(pool, req.userId!);
      if (body.status === "published") {
        await subscriptionAccess.assertOrganizerCanPublishNewEvent(pool, req.userId!);
      }
      const primaryCategory =
        body.categoryIds && body.categoryIds.length > 0
          ? body.categoryIds[0]!
          : body.categoryId ?? null;
      const id = await eventRepo.insertEvent(pool, {
        organizerUserId: req.userId!,
        categoryId: primaryCategory,
        title: body.title,
        description: body.description ?? null,
        venueName: body.venueName,
        venueCity: body.venueCity ?? null,
        venueCountry: body.venueCountry ?? null,
        venueState: body.venueState ?? null,
        address: body.address ?? null,
        latitude: body.latitude ?? null,
        longitude: body.longitude ?? null,
        startsAt: new Date(body.startsAt),
        endsAt: new Date(body.endsAt),
        isB2b: body.isB2b,
        isB2c: body.isB2c,
        tags: body.tags ?? null,
        requireBookingApproval: body.requireBookingApproval,
        entryQrAllowReentry: body.entryQrAllowReentry,
        status: body.status,
      });
      const linkIds = body.categoryIds?.length ? body.categoryIds : primaryCategory != null ? [primaryCategory] : [];
      await eventCatRepo.replaceEventCategoryLinks(pool, id, linkIds);
      const ev = await eventRepo.findEventById(pool, id);
      const categoryIds = await eventCatRepo.listCategoryIdsForEvent(pool, id);
      res.status(201).json({ event: { ...serializeEvent(ev!), categoryIds } });
    },

    organizerUpdateEvent: async (req: AuthedRequest, res: Response) => {
      const eventId = pid(req.params.eventId);
      const body = updateEventSchema.parse(req.body);
      if (body.status === "published") {
        await subscriptionAccess.assertOrganizerCanPublishEvent(pool, req.userId!, eventId);
      }
      let legacyCat = body.categoryId;
      if (body.categoryIds !== undefined) {
        legacyCat = body.categoryIds.length ? body.categoryIds[0]! : null;
        await eventCatRepo.replaceEventCategoryLinks(pool, eventId, body.categoryIds);
      }
      const ok = await eventRepo.updateEvent(pool, eventId, req.userId!, {
        categoryId: legacyCat,
        title: body.title,
        description: body.description,
        venueName: body.venueName,
        venueCity: body.venueCity,
        venueCountry: body.venueCountry,
        venueState: body.venueState,
        address: body.address,
        latitude: body.latitude,
        longitude: body.longitude,
        startsAt: body.startsAt ? new Date(body.startsAt) : undefined,
        endsAt: body.endsAt ? new Date(body.endsAt) : undefined,
        isB2b: body.isB2b,
        isB2c: body.isB2c,
        tags: body.tags,
        requireBookingApproval: body.requireBookingApproval,
        entryQrAllowReentry: body.entryQrAllowReentry,
        status: body.status,
      });
      if (!ok) throw new HttpError(404, "Event not found");
      const ev = await eventRepo.findEventById(pool, eventId);
      const categoryIds = await eventCatRepo.listCategoryIdsForEvent(pool, eventId);
      const merged = categoryIds.length ? categoryIds : ev!.category_id != null ? [ev!.category_id] : [];
      res.json({ event: { ...serializeEvent(ev!), categoryIds: merged } });
    },

    /** Plan-compat: explicit publish endpoint. */
    organizerPublishEvent: async (req: AuthedRequest, res: Response) => {
      const eventId = pid(req.params.eventId);
      const ev = await eventRepo.findEventById(pool, eventId);
      if (!ev || ev.organizer_user_id !== req.userId!) throw new HttpError(404, "Event not found");
      await subscriptionAccess.assertOrganizerCanPublishEvent(pool, req.userId!, eventId);
      const ok = await eventRepo.updateEvent(pool, eventId, req.userId!, { status: "published" });
      if (!ok) throw new HttpError(404, "Event not found");
      await moderationRepo.ensureOpenFlag(pool, { entityType: "event", entityId: String(eventId) });
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
      res.json({
        ticketTypes: rows.map((t) => ({
          id: String(t.id),
          name: t.name,
          priceMinor: String(t.price_minor),
          quota: t.quota,
          soldCount: t.sold_count,
          currency: "INR",
        })),
      });
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

    organizerUpdateTicketType: async (req: AuthedRequest, res: Response) => {
      const eventId = pid(req.params.eventId);
      const typeId = pid(req.params.ticketTypeId);
      const ev = await eventRepo.findEventById(pool, eventId);
      if (!ev || ev.organizer_user_id !== req.userId!) throw new HttpError(404, "Event not found");
      const body = ticketTypeUpdateSchema.parse(req.body);
      const r = await ticketRepo.updateTicketType(pool, eventId, typeId, {
        name: body.name,
        price_minor: body.priceMinor !== undefined ? BigInt(body.priceMinor) : undefined,
        quota: body.quota,
      });
      if (r === "not_found") throw new HttpError(404, "Ticket type not found");
      if (r === "quota") throw new HttpError(400, "Quota cannot be less than tickets already sold");
      res.json({ ok: true });
    },

    organizerDeleteTicketType: async (req: AuthedRequest, res: Response) => {
      const eventId = pid(req.params.eventId);
      const typeId = pid(req.params.ticketTypeId);
      const ev = await eventRepo.findEventById(pool, eventId);
      if (!ev || ev.organizer_user_id !== req.userId!) throw new HttpError(404, "Event not found");
      const r = await ticketRepo.deleteTicketType(pool, eventId, typeId);
      if (r === "not_found") throw new HttpError(404, "Ticket type not found");
      if (r === "has_tickets") {
        throw new HttpError(
          400,
          "Cannot remove this ticket type while tickets have been issued. Reduce quota only, or archive elsewhere."
        );
      }
      res.json({ ok: true });
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

        const needApproval = Boolean((ev as EventRow).require_booking_approval);
        let razorpayOrderId: string | null = null;
        if (needApproval) {
          await conn.query(`UPDATE bookings SET status = 'pending_approval' WHERE id = ?`, [bookingId]);
        } else if (subtotal > 0n) {
          const order = await razorpay.createOrder(Number(subtotal), "INR", `bk_${bookingId}`);
          razorpayOrderId = order.orderId;
          await conn.query("UPDATE bookings SET razorpay_order_id = ? WHERE id = ?", [
            razorpayOrderId,
            bookingId,
          ]);
        } else {
          await conn.query("UPDATE bookings SET status = 'confirmed' WHERE id = ?", [bookingId]);
          for (const sid of stallIds) {
            await conn.query("UPDATE stalls SET status = 'booked' WHERE id = ? AND event_id = ?", [
              sid,
              eventId,
            ]);
            await conn.query("DELETE FROM stall_holds WHERE stall_id = ?", [sid]);
          }
        }

        await conn.commit();
        if (!needApproval && subtotal === 0n) {
          emailLater(() => notifyStallBookingConfirmed(pool, bookingId));
        }
        res.status(201).json({
          bookingId: String(bookingId),
          subtotalMinor: String(subtotal),
          currency: "INR",
          razorpayOrderId,
          razorpayKeyId: process.env.RAZORPAY_KEY_ID ?? "",
          awaitsOrganizerApproval: needApproval,
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
      if (booking.status === "pending_approval") {
        throw new HttpError(400, "Booking awaits organizer approval before payment");
      }
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
        await conn.commit();
        emailLater(() => notifyStallBookingConfirmed(pool, bookingId));
        await insertBookingPaymentRecord(pool, {
          payerUserId: req.userId!,
          amountMinor: booking.subtotal_minor,
          razorpayOrderId: body.razorpayOrderId,
          razorpayPaymentId: body.razorpayPaymentId,
          bookingId,
          eventId: booking.event_id,
        });
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
          emailLater(() => notifyTicketOrderConfirmed(pool, orderId, ticketsOut));
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
        await conn.commit();
        emailLater(() => notifyTicketOrderConfirmed(pool, orderId, ticketsOut));
        await insertTicketOrderPaymentRecord(pool, {
          payerUserId: req.userId!,
          amountMinor: order.total_minor,
          razorpayOrderId: body.razorpayOrderId,
          razorpayPaymentId: body.razorpayPaymentId,
          ticketOrderId: orderId,
        });
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
          let raw = await ticketRepo.getQrRawSecretForTicket(pool, BigInt(t.id), req.userId!);

          // Backfill raw_secret for legacy tickets so we can display QR payload again.
          // This intentionally rotates the QR secret for those tickets (old QR becomes invalid).
          if (!raw) {
            const ticketId = BigInt(t.id);
            const newRaw = randomToken(16);
            const newHash = sha256Hex(newRaw);

            await pool.query<ResultSetHeader>(
              `UPDATE qr_tokens q
               INNER JOIN tickets tk ON tk.id = q.ticket_id
               SET q.secret_hash = ?, q.raw_secret = ?
               WHERE q.ticket_id = ? AND tk.visitor_user_id = ? AND q.raw_secret IS NULL`,
              [newHash, newRaw, ticketId, req.userId!]
            );

            raw = await ticketRepo.getQrRawSecretForTicket(pool, ticketId, req.userId!);
          }
          return {
            id: t.id,
            eventId: t.event_id,
            eventTitle: t.event_title,
            ticketTypeName: t.ticket_type_name ?? null,
            eventStartsAt: t.event_starts_at ?? null,
            venueName: t.venue_name ?? null,
            status: t.status,
            createdAt: t.created_at,
            qrPayload: raw ? `TFW1.${t.id}.${raw}` : null,
          };
        })
      );
      res.json({ tickets: enriched });
    },

    /** Dev/local: create one free ticket + QR when the visitor has none (or use any published ₹0 ticket slot). */
    visitorCreateDemoTicket: async (req: AuthedRequest, res: Response) => {
      if (!allowDemoVisitorTickets()) throw new HttpError(403, "Demo tickets disabled");

      const existing = await ticketRepo.listTicketsForVisitor(pool, req.userId!);
      if (existing.length > 0) throw new HttpError(400, "You already have tickets");

      const { eventId, ticketTypeId } = await ensureDemoFairForQrDemo(pool);

      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const [upd] = await conn.query<ResultSetHeader>(
          "UPDATE ticket_types SET sold_count = sold_count + 1 WHERE id = ? AND sold_count + 1 <= quota",
          [ticketTypeId]
        );
        if (upd.affectedRows !== 1) throw new HttpError(409, "Ticket quota exceeded");

        const [tor] = await conn.query<ResultSetHeader>(
          `INSERT INTO ticket_orders (event_id, visitor_user_id, ticket_type_id, quantity, status, currency, total_minor, razorpay_order_id)
           VALUES (?,?,?,?,?,?,?,?)`,
          [eventId, req.userId!, ticketTypeId, 1, "paid", "INR", 0, null]
        );
        const orderId = BigInt(tor.insertId);

        const [tr] = await conn.query<ResultSetHeader>(
          `INSERT INTO tickets (ticket_order_id, ticket_type_id, visitor_user_id, event_id, status)
           VALUES (?,?,?,?, 'unused')`,
          [orderId, ticketTypeId, req.userId!, eventId]
        );
        const ticketId = BigInt(tr.insertId);
        const raw = randomToken(16);
        const hash = sha256Hex(raw);
        await conn.query(`INSERT INTO qr_tokens (ticket_id, secret_hash, raw_secret) VALUES (?,?,?)`, [
          ticketId,
          hash,
          raw,
        ]);
        await conn.commit();

        res.status(201).json({
          ok: true,
          ticket: {
            id: String(ticketId),
            eventId: String(eventId),
            qrPayload: `TFW1.${ticketId}.${raw}`,
          },
        });
      } catch (e) {
        await conn.rollback();
        throw e;
      } finally {
        conn.release();
      }
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
      const { processVisitorQrScan } = await import("../services/entryScanService.js");
      const result = await processVisitorQrScan(pool, {
        eventId,
        payload: body.payload,
        scannedByUserId: req.userId!,
      });
      res.json(result);
    },

    /** Server-Sent Events: live gate scan feed for organizers (use ?access_token=… when EventSource cannot send Authorization). */
    organizerGateLiveStream: async (req: AuthedRequest, res: Response) => {
      let uid = req.userId;
      const authHeader = req.headers.authorization;
      if (!uid && authHeader?.startsWith("Bearer ")) {
        try {
          const payload = verifyAccessToken(authHeader.slice("Bearer ".length).trim());
          uid = BigInt(payload.sub);
        } catch {
          throw new HttpError(401, "Invalid bearer token");
        }
      }
      if (!uid && typeof req.query.access_token === "string") {
        try {
          const payload = verifyAccessToken(req.query.access_token);
          uid = BigInt(payload.sub);
        } catch {
          throw new HttpError(401, "Invalid access_token query param");
        }
      }
      if (!uid) throw new HttpError(401, "Unauthorized");
      const roles = await userRepo.getRoleCodesForUser(pool, uid);
      if (!roles.includes("ORGANIZER")) throw new HttpError(403, "Organizer role required");
      const eventId = pid(req.params.eventId);
      const ev = await eventRepo.findEventById(pool, eventId);
      if (!ev || ev.organizer_user_id !== uid) throw new HttpError(404, "Event not found");
      res.status(200);
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders();
      const send = (payload: Record<string, unknown>) => {
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      };
      const unsub = subscribeGateScan(eventId, send);
      req.on("close", () => {
        unsub();
      });
      send({ connected: true, eventId: String(eventId) });
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

    organizerGetEventReports: async (req: AuthedRequest, res: Response) => {
      const eventId = pid(req.params.eventId);
      const ev = await eventRepo.findEventById(pool, eventId);
      if (!ev || ev.organizer_user_id !== req.userId!) throw new HttpError(404, "Event not found");
      const summary = await organizerReadRepo.getEventReportsSummary(pool, eventId);
      res.json({ summary });
    },

    organizerExportEventReportsCsv: async (req: AuthedRequest, res: Response) => {
      const eventId = pid(req.params.eventId);
      const ev = await eventRepo.findEventById(pool, eventId);
      if (!ev || ev.organizer_user_id !== req.userId!) throw new HttpError(404, "Event not found");
      const csv = await organizerReadRepo.buildEventReportsCsv(pool, eventId);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="event_${String(eventId)}_stalls_tickets.csv"`);
      res.status(200).send(csv);
    },

    organizerCancelEventBooking: async (req: AuthedRequest, res: Response) => {
      const eventId = pid(req.params.eventId);
      const bookingId = pid(req.params.bookingId);
      const ev = await eventRepo.findEventById(pool, eventId);
      if (!ev || ev.organizer_user_id !== req.userId!) throw new HttpError(404, "Event not found");
      const r = await bookingRepo.cancelBookingAsOrganizer(pool, bookingId, eventId);
      if (r === "not_found") throw new HttpError(404, "Booking not found");
      res.json({ ok: true, alreadyCancelled: r === "already" });
    },

    organizerApproveEventBooking: async (req: AuthedRequest, res: Response) => {
      const eventId = pid(req.params.eventId);
      const bookingId = pid(req.params.bookingId);
      const ev = await eventRepo.findEventById(pool, eventId);
      if (!ev || ev.organizer_user_id !== req.userId!) throw new HttpError(404, "Event not found");
      const r = await bookingRepo.approveBookingAsOrganizer(pool, bookingId, eventId, (amt, cur, rec) =>
        razorpay.createOrder(amt, cur, rec)
      );
      if (!r.ok) {
        if (r.code === "not_found") throw new HttpError(404, "Booking not found");
        if (r.code === "bad_status") throw new HttpError(400, "Booking is not awaiting organizer approval");
        if (r.code === "payment_setup_failed") throw new HttpError(502, r.message ?? "Could not create payment order");
        throw new HttpError(500, "Unknown error");
      }
      if (r.razorpayOrderId == null) {
        emailLater(() => notifyStallBookingConfirmed(pool, bookingId));
      }
      res.json({
        ok: true,
        razorpayOrderId: r.razorpayOrderId,
        razorpayKeyId: process.env.RAZORPAY_KEY_ID ?? "",
      });
    },

    organizerReassignBookingStall: async (req: AuthedRequest, res: Response) => {
      const eventId = pid(req.params.eventId);
      const bookingId = pid(req.params.bookingId);
      const body = organizerBookingReassignSchema.parse(req.body);
      const ev = await eventRepo.findEventById(pool, eventId);
      if (!ev || ev.organizer_user_id !== req.userId!) throw new HttpError(404, "Event not found");
      const code = await bookingRepo.organizerReassignBookingItemStall(
        pool,
        bookingId,
        BigInt(body.bookingItemId),
        eventId,
        BigInt(body.newStallId)
      );
      if (code === "not_found") throw new HttpError(404, "Booking not found");
      if (code === "bad_item") throw new HttpError(404, "Booking line not found");
      if (code === "bad_status") throw new HttpError(400, "Cannot reassign for this booking status");
      if (code === "stall_unavailable") throw new HttpError(409, "Target stall not available");
      res.json({ ok: true, unchanged: code === "same_stall" });
    },

    organizerUpdateStallType: async (req: AuthedRequest, res: Response) => {
      const eventId = pid(req.params.eventId);
      const typeId = pid(req.params.stallTypeId);
      const body = stallTypeUpdateSchema.parse(req.body);
      const ev = await eventRepo.findEventById(pool, eventId);
      if (!ev || ev.organizer_user_id !== req.userId!) throw new HttpError(404, "Event not found");
      const ok = await stallRepo.updateStallType(pool, eventId, typeId, {
        code: body.code,
        name: body.name,
        price_minor: body.priceMinor !== undefined ? BigInt(body.priceMinor) : undefined,
        currency: body.currency,
        description: body.description,
      });
      if (!ok) throw new HttpError(404, "Stall type not found");
      res.json({ ok: true });
    },

    organizerDeleteStallType: async (req: AuthedRequest, res: Response) => {
      const eventId = pid(req.params.eventId);
      const typeId = pid(req.params.stallTypeId);
      const ev = await eventRepo.findEventById(pool, eventId);
      if (!ev || ev.organizer_user_id !== req.userId!) throw new HttpError(404, "Event not found");
      const r = await stallRepo.deleteStallType(pool, eventId, typeId);
      if (r === "not_found") throw new HttpError(404, "Stall type not found");
      if (r === "in_use") throw new HttpError(409, "Cannot delete stall type that still has stalls");
      res.json({ ok: true });
    },

    organizerDeleteStallUnit: async (req: AuthedRequest, res: Response) => {
      const eventId = pid(req.params.eventId);
      const stallId = pid(req.params.stallId);
      const ev = await eventRepo.findEventById(pool, eventId);
      if (!ev || ev.organizer_user_id !== req.userId!) throw new HttpError(404, "Event not found");
      const r = await stallRepo.deleteStallIfUnused(pool, eventId, stallId);
      if (r === "not_found") throw new HttpError(404, "Stall not found");
      if (r === "busy") throw new HttpError(409, "Stall is held, booked, or not removable");
      res.json({ ok: true });
    },

    organizerPatchAnnouncement: async (req: AuthedRequest, res: Response) => {
      const eventId = pid(req.params.eventId);
      const annId = pid(req.params.announcementId);
      const body = announcementPatchSchema.parse(req.body);
      const ev = await eventRepo.findEventById(pool, eventId);
      if (!ev || ev.organizer_user_id !== req.userId!) throw new HttpError(404, "Event not found");
      const ok = await announcementRepo.updateAnnouncement(pool, eventId, annId, {
        title: body.title,
        body: body.body,
        audience: body.audience,
      });
      if (!ok) throw new HttpError(404, "Announcement not found");
      res.json({ ok: true });
    },

    organizerDeleteAnnouncement: async (req: AuthedRequest, res: Response) => {
      const eventId = pid(req.params.eventId);
      const annId = pid(req.params.announcementId);
      const ev = await eventRepo.findEventById(pool, eventId);
      if (!ev || ev.organizer_user_id !== req.userId!) throw new HttpError(404, "Event not found");
      const ok = await announcementRepo.deleteAnnouncement(pool, eventId, annId);
      if (!ok) throw new HttpError(404, "Announcement not found");
      res.status(204).send();
    },

    organizerListReminders: async (req: AuthedRequest, res: Response) => {
      const eventId = pid(req.params.eventId);
      const ev = await eventRepo.findEventById(pool, eventId);
      if (!ev || ev.organizer_user_id !== req.userId!) throw new HttpError(404, "Event not found");
      const reminders = await eventReminderRepo.listRemindersForEvent(pool, eventId);
      res.json({ reminders });
    },

    organizerCreateReminder: async (req: AuthedRequest, res: Response) => {
      const eventId = pid(req.params.eventId);
      const body = eventReminderCreateSchema.parse(req.body);
      const ev = await eventRepo.findEventById(pool, eventId);
      if (!ev || ev.organizer_user_id !== req.userId!) throw new HttpError(404, "Event not found");
      const id = await eventReminderRepo.insertReminder(pool, {
        eventId,
        remindAt: new Date(body.remindAt),
        channel: body.channel ?? "email",
        title: body.title ?? "",
        body: body.body,
        audience: body.audience ?? "both",
      });
      res.status(201).json({ id: String(id) });
    },

    organizerPatchReminder: async (req: AuthedRequest, res: Response) => {
      const eventId = pid(req.params.eventId);
      const reminderId = pid(req.params.reminderId);
      const body = eventReminderPatchSchema.parse(req.body);
      const ev = await eventRepo.findEventById(pool, eventId);
      if (!ev || ev.organizer_user_id !== req.userId!) throw new HttpError(404, "Event not found");
      const ok = await eventReminderRepo.updateReminder(pool, eventId, reminderId, {
        remindAt: body.remindAt ? new Date(body.remindAt) : undefined,
        channel: body.channel,
        title: body.title,
        body: body.body,
        audience: body.audience,
        status: body.status,
      });
      if (!ok) throw new HttpError(404, "Reminder not found");
      res.json({ ok: true });
    },

    organizerDeleteReminder: async (req: AuthedRequest, res: Response) => {
      const eventId = pid(req.params.eventId);
      const reminderId = pid(req.params.reminderId);
      const ev = await eventRepo.findEventById(pool, eventId);
      if (!ev || ev.organizer_user_id !== req.userId!) throw new HttpError(404, "Event not found");
      const ok = await eventReminderRepo.deleteReminder(pool, eventId, reminderId);
      if (!ok) throw new HttpError(404, "Reminder not found");
      res.status(204).send();
    },

    organizerListCommunicationLogs: async (req: AuthedRequest, res: Response) => {
      const eventId = pid(req.params.eventId);
      const ev = await eventRepo.findEventById(pool, eventId);
      if (!ev || ev.organizer_user_id !== req.userId!) throw new HttpError(404, "Event not found");
      const communications = await organizerCommRepo.listCommunicationLogs(pool, eventId);
      res.json({ communications });
    },

    organizerBulkCommunicate: async (req: AuthedRequest, res: Response) => {
      const eventId = pid(req.params.eventId);
      const body = organizerBulkCommunicationSchema.parse(req.body);
      const ev = await eventRepo.findEventById(pool, eventId);
      if (!ev || ev.organizer_user_id !== req.userId!) throw new HttpError(404, "Event not found");
      const recipientCount = await organizerReadRepo.countAudienceRecipients(pool, eventId, body.audience);

      let emails: string[] = [];
      let phones: string[] = [];
      if (body.audience === "exhibitors") {
        emails = await organizerReadRepo.listExhibitorEmailsForEvent(pool, eventId);
        phones = await organizerReadRepo.listExhibitorPhonesForEvent(pool, eventId);
      } else if (body.audience === "visitors") {
        emails = await organizerReadRepo.listVisitorEmailsForEvent(pool, eventId);
        phones = await organizerReadRepo.listVisitorPhonesForEvent(pool, eventId);
      } else {
        emails = [
          ...new Set([
            ...(await organizerReadRepo.listExhibitorEmailsForEvent(pool, eventId)),
            ...(await organizerReadRepo.listVisitorEmailsForEvent(pool, eventId)),
          ]),
        ];
        phones = [
          ...new Set([
            ...(await organizerReadRepo.listExhibitorPhonesForEvent(pool, eventId)),
            ...(await organizerReadRepo.listVisitorPhonesForEvent(pool, eventId)),
          ]),
        ];
      }

      let deliveryNote = "";
      let delivered = false;
      if (body.channel === "email") {
        const r = await sendSmtpEmail({
          to: emails,
          subject: body.subject?.trim() || "Message from organizer",
          text: body.body,
        });
        delivered = r.ok;
        deliveryNote = r.ok ? "Email sent (SMTP)" : (r.error ?? "Email failed");
      } else if (body.channel === "whatsapp") {
        let okN = 0;
        for (const ph of phones.slice(0, 200)) {
          const w = await sendWhatsAppCloud(ph, body.body);
          if (w.ok) okN += 1;
        }
        delivered = okN > 0;
        deliveryNote = delivered ? `WhatsApp: ${okN} message(s)` : "WhatsApp not configured or all sends failed";
      } else {
        deliveryNote = "in_app log only (no email/WhatsApp send)";
      }

      const id = await organizerCommRepo.insertCommunicationLog(pool, {
        eventId,
        createdByUserId: req.userId!,
        channel: body.channel,
        audience: body.audience,
        subject: body.subject ?? null,
        body: body.body,
        recipientCount,
        meta: { deliveryNote, emailCount: emails.length, phoneCount: phones.length },
      });
      res.status(201).json({
        id: String(id),
        recipientCount,
        delivered,
        message: deliveryNote,
      });
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

    /** Plan-compat: list exhibitor-visible events (same as public list, plus favorite ids). */
    exhibitorListEvents: async (req: AuthedRequest, res: Response) => {
      const search = typeof req.query.search === "string" ? req.query.search : undefined;
      const categoryRaw = req.query.categoryId;
      const categoryId =
        typeof categoryRaw === "string" && categoryRaw.match(/^\d+$/) ? Number(categoryRaw) : undefined;
      const b2bOnly = req.query.b2b === "1" || req.query.b2b === "true";
      const b2cOnly = req.query.b2c === "1" || req.query.b2c === "true";
      const venueCity = typeof req.query.venueCity === "string" ? req.query.venueCity : undefined;
      const venueState = typeof req.query.venueState === "string" ? req.query.venueState : undefined;
      const dateFrom = typeof req.query.dateFrom === "string" ? req.query.dateFrom : undefined;
      const dateTo = typeof req.query.dateTo === "string" ? req.query.dateTo : undefined;
      const favoritesOnly = req.query.favorites === "1" || req.query.favorites === "true";
      const rows = await eventRepo.listPublishedEventsWithCover(pool, {
        search,
        categoryId,
        b2bOnly: b2bOnly || undefined,
        b2cOnly: b2cOnly || undefined,
        venueCity,
        venueState,
        dateFrom,
        dateTo,
        favoritesUserId: favoritesOnly ? req.userId! : undefined,
      });
      const favoriteIds = await exhibitorFavoriteRepo.listFavoriteEventIdsForUser(pool, req.userId!);
      res.json({
        events: rows.map(({ event, coverImageUrl }) => ({
          ...serializeEvent(event),
          coverImageUrl,
        })),
        favoriteEventIds: favoriteIds.map((id) => String(id)),
      });
    },

    exhibitorAddEventFavorite: async (req: AuthedRequest, res: Response) => {
      const eventId = pid(req.params.eventId);
      const ev = await eventRepo.findEventById(pool, eventId);
      if (!ev || ev.status !== "published" || ev.ends_at < new Date()) {
        throw new HttpError(404, "Event not found");
      }
      try {
        await exhibitorFavoriteRepo.addFavorite(pool, req.userId!, eventId);
      } catch (e: unknown) {
        if (typeof e === "object" && e && "code" in e && (e as { code?: string }).code === "FAVORITES_TABLE_MISSING") {
          throw new HttpError(
            503,
            "Favourites storage is not set up on this database. Run trade-fair-backend/db/017_app_self_heal_after_migrations.sql (or restart the API once) and retry."
          );
        }
        throw e;
      }
      res.status(201).json({ ok: true });
    },

    exhibitorRemoveEventFavorite: async (req: AuthedRequest, res: Response) => {
      const eventId = pid(req.params.eventId);
      await exhibitorFavoriteRepo.removeFavorite(pool, req.userId!, eventId);
      res.json({ ok: true });
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
      // Allow any logged-in user to complete exhibitor onboarding without a pre-assigned role.
      // Once they start using exhibitor screens, we grant the EXHIBITOR role.
      const roles = await userRepo.getRoleCodesForUser(pool, req.userId!);
      if (!roles.includes("EXHIBITOR")) {
        await userRepo.assignRoleByCode(pool, req.userId!, "EXHIBITOR");
      }
      const profile = await exhibitorProfileRepo.getExhibitorProfile(pool, req.userId!);
      res.json({ profile: profile ?? null });
    },

    exhibitorPatchProfile: async (req: AuthedRequest, res: Response) => {
      const body = exhibitorProfileSchema.parse(req.body);
      const roles = await userRepo.getRoleCodesForUser(pool, req.userId!);
      if (!roles.includes("EXHIBITOR")) {
        await userRepo.assignRoleByCode(pool, req.userId!, "EXHIBITOR");
      }
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

    organizerUploadEventMedia: async (req: AuthedRequest, res: Response) => {
      const file = (req as AuthedRequest & { file?: { filename: string } }).file;
      if (!file) throw new HttpError(400, "Missing file (use multipart field name \"file\")");
      const eventId = pid(req.params.eventId);
      const ev = await eventRepo.findEventById(pool, eventId);
      if (!ev || ev.organizer_user_id !== req.userId!) throw new HttpError(404, "Event not found");
      const relativePath = `events/${eventId}/${file.filename}`;
      /** Same-origin path so cards & `<img>` work when the UI is on Next (3000) and API is proxied or on another port. */
      const prefix = env.apiPrefix.startsWith("/") ? env.apiPrefix : `/${env.apiPrefix}`;
      const url = `${prefix}/static/uploads/${relativePath}`;
      const [sortRows] = await pool.query<RowDataPacket[]>(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_sort FROM event_media WHERE event_id = ?",
        [eventId]
      );
      const sortOrder = Number(sortRows[0]?.next_sort ?? 0);
      const id = await eventMediaRepo.insertEventMedia(pool, {
        eventId,
        url,
        mediaType: "image",
        sortOrder,
      });
      res.status(201).json({ id: String(id), url });
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
      const body = stallOrganizerPatchSchema.parse(req.body);
      const ev = await eventRepo.findEventById(pool, eventId);
      if (!ev || ev.organizer_user_id !== req.userId!) throw new HttpError(404, "Event not found");
      const stall = await stallRepo.findStall(pool, stallId, eventId);
      if (!stall) throw new HttpError(404, "Stall not found");

      if (body.status !== undefined) {
        if (stall.status === "booked" && body.status !== "booked") {
          throw new HttpError(409, "Cannot change status of a booked stall from this endpoint");
        }
        const ok = await stallRepo.setStallStatus(pool, stallId, eventId, body.status);
        if (!ok) throw new HttpError(404, "Stall not found");
      }

      if (
        body.label !== undefined ||
        body.gridRow !== undefined ||
        body.gridCol !== undefined ||
        body.stallTypeId !== undefined
      ) {
        if (stall.status === "booked" || stall.status === "held") {
          throw new HttpError(409, "Cannot edit layout/type of a held or booked stall");
        }
        await stallRepo.updateStallLayout(pool, eventId, stallId, {
          label: body.label,
          gridRow: body.gridRow,
          gridCol: body.gridCol,
          stallTypeId: body.stallTypeId !== undefined ? BigInt(body.stallTypeId) : undefined,
        });
      }

      res.json({ ok: true });
    },

    organizerGetPayoutProfile: async (req: AuthedRequest, res: Response) => {
      const flags = {
        routeTransfersEnabled: env.razorpay.routeTransfersEnabled,
        routeAutoLinkedAccount: env.razorpay.routeAutoLinkedAccount,
      };
      const row = await organizerPayoutRepo.findOrganizerPayoutProfile(pool, req.userId!);
      if (!row) {
        res.json({
          profile: null,
          ...flags,
        });
        return;
      }
      res.json({
        profile: {
          accountHolderName: row.accountHolderName,
          bankAccountNumber: row.bankAccountNumber,
          ifsc: row.ifsc,
          upiId: row.upiId,
          razorpayLinkedAccountId: row.razorpayLinkedAccountId,
          updatedAt: row.updatedAt,
        },
        ...flags,
      });
    },

    organizerPutPayoutProfile: async (req: AuthedRequest, res: Response) => {
      const body = organizerPayoutProfilePutSchema.parse(req.body);
      const bankNum = (body.bankAccountNumber ?? "").replace(/\s/g, "") || null;
      const ifsc = body.ifsc?.trim().toUpperCase() || null;
      const upi = body.upiId?.trim() || null;
      const linked = body.razorpayLinkedAccountId?.trim() || null;
      const stakeholderPan = body.stakeholderPan?.trim().toUpperCase() || undefined;
      let holder = body.accountHolderName?.trim() ?? "";
      if (!holder) {
        if (upi) holder = upi.split("@")[0]?.slice(0, 255) || "UPI";
        else if (bankNum) holder = "Bank account";
        else holder = "Organizer";
      }

      const existing = await organizerPayoutRepo.findOrganizerPayoutProfile(pool, req.userId!);
      const flags = {
        routeTransfersEnabled: env.razorpay.routeTransfersEnabled,
        routeAutoLinkedAccount: env.razorpay.routeAutoLinkedAccount,
      };

      let resolvedLinked: string | null = linked;
      let routeOnboarding: "off" | "skipped_manual_linked" | "skipped_has_linked" | "skipped_no_bank" | "skipped_missing_contact" | "created" | "failed" =
        env.razorpay.routeAutoLinkedAccount ? "skipped_no_bank" : "off";
      let routeOnboardingDetail: string | undefined;

      if (linked) {
        routeOnboarding = "skipped_manual_linked";
      } else if (!env.razorpay.routeAutoLinkedAccount) {
        routeOnboarding = "off";
        resolvedLinked = linked ?? existing?.razorpayLinkedAccountId ?? null;
      } else if (!bankNum || !ifsc) {
        routeOnboarding = "skipped_no_bank";
        resolvedLinked = existing?.razorpayLinkedAccountId ?? null;
      } else if (existing?.razorpayLinkedAccountId) {
        routeOnboarding = "skipped_has_linked";
        resolvedLinked = existing.razorpayLinkedAccountId;
      } else {
        const user = await userRepo.findUserById(pool, req.userId!);
        const phoneNorm = organizerRouteOnboarding.normalizeIndianPhoneDigits(user?.phone ?? undefined);
        if (!user?.email || !phoneNorm) {
          routeOnboarding = "skipped_missing_contact";
          routeOnboardingDetail =
            "Route auto-setup ke liye Account par email aur phone number hona zaroori hai (Account settings).";
          resolvedLinked = null;
        } else {
          try {
            resolvedLinked = await organizerRouteOnboarding.createRouteLinkedAccountForOrganizer({
              userId: req.userId!,
              email: user.email,
              phoneDigits: phoneNorm,
              legalBusinessName: holder,
              contactName: holder,
              bankAccountNumber: bankNum,
              ifsc,
              beneficiaryName: holder,
              stakeholderPan,
            });
            routeOnboarding = "created";
          } catch (e) {
            routeOnboarding = "failed";
            routeOnboardingDetail = e instanceof Error ? e.message : String(e);
            resolvedLinked = existing?.razorpayLinkedAccountId ?? null;
          }
        }
      }

      await organizerPayoutRepo.upsertOrganizerPayoutProfile(pool, {
        userId: req.userId!,
        accountHolderName: holder,
        bankAccountNumber: bankNum,
        ifsc,
        upiId: upi,
        razorpayLinkedAccountId: resolvedLinked,
      });

      res.json({
        ok: true,
        razorpayLinkedAccountId: resolvedLinked,
        routeOnboarding,
        routeOnboardingDetail,
        ...flags,
      });
    },

    exhibitorListBookings: async (req: AuthedRequest, res: Response) => {
      const bookings = await bookingRepo.listBookingsForExhibitor(pool, req.userId!);
      res.json({
        bookings,
        razorpayKeyId: process.env.RAZORPAY_KEY_ID ?? "",
      });
    },
  };
}
