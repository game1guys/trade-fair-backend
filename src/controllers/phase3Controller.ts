import type { Pool } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import type { Response } from "express";
import * as auditRepo from "../repositories/auditRepository.js";
import * as eventRepo from "../repositories/eventRepository.js";
import * as marketplaceRepo from "../repositories/marketplaceRepository.js";
import * as paymentRepo from "../repositories/paymentRepository.js";
import * as userRepo from "../repositories/userRepository.js";
import * as moderationRepo from "../repositories/moderationRepository.js";
import * as razorpay from "../services/razorpayService.js";
import { insertServiceBookingPaymentRecord } from "../services/paymentFinalizeService.js";
import { ensureInvoiceForPayment } from "../services/invoiceService.js";
import { notifyAfterPaymentRecorded } from "../services/transactionalEmail.js";
import * as referralRepo from "../repositories/referralCodeRepository.js";
import { resolveReferralForSubscription } from "../services/referralCodeService.js";
import * as subAccess from "../services/subscriptionAccessService.js";
import { env } from "../config/env.js";
import {
  emailContractAccepted,
  emailContractDeclined,
  emailContractSentToProvider,
  emailEnquiryReplyToCustomer,
  emailLater,
  emailServiceEnquiryToProvider,
  emailServiceRequestMessage,
} from "../services/transactionalEmail.js";
import { HttpError } from "../utils/httpError.js";
import { marketplaceDealStage } from "../utils/marketplaceDealStage.js";
import type { AuthedRequest } from "../middlewares/authMiddleware.js";
import { verifyRazorpaySchema } from "../validators/phase1Schemas.js";
import {
  adminSubscribeUserSchema,
  organizerProviderRatingSchema,
  providerBookingCreateSchema,
  providerServiceBookingPatchSchema,
  providerProfileSchema,
  refundRequestSchema,
  serviceCreateSchema,
  servicePatchSchema,
  serviceRequestCreateSchema,
  serviceRequestPatchSchema,
  serviceRequestMessageCreateSchema,
  serviceRequestContractSendSchema,
  serviceRequestContractAcceptSchema,
  serviceRequestContractDeclineSchema,
  serviceReviewCreateSchema,
  subscriptionCheckoutSchema,
  subscriptionPlanSchema,
  subscriptionVerifySchema,
  subscriptionReferralValidateSchema,
  referralCodeUpsertSchema,
} from "../validators/phase3Schemas.js";

function pid(v: string | string[] | undefined): bigint {
  const s = Array.isArray(v) ? v[0] : v;
  if (!s) throw new HttpError(400, "Missing id");
  return BigInt(s);
}

function contractServiceLineFromRequest(row: RowDataPacket): string {
  const title = String(row.service_title ?? "Service").trim();
  const cat = row.category_name != null ? String(row.category_name).trim() : "";
  return cat ? `${title} — ${cat}` : title;
}

function serializeContract(row: RowDataPacket | null) {
  if (!row) return null;
  return {
    id: String(row.id),
    status: marketplaceRepo.normalizeContractStatus(row.status),
    serviceDescription: String(row.service_description),
    durationDays: Number(row.duration_days),
    peopleCount: Number(row.people_count),
    manpowerAvailable: row.manpower_available != null ? Number(row.manpower_available) : null,
    machinery: marketplaceRepo.parseMachineryJson(row.machinery_json),
    organizerNotes: row.organizer_notes != null ? String(row.organizer_notes) : null,
    providerNotes: row.provider_notes != null ? String(row.provider_notes) : null,
    sentAt: row.sent_at,
    acceptedAt: row.accepted_at ?? null,
  };
}

function parseJsonUrls(raw: unknown): string[] | null {
  if (raw == null) return null;
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === "string") {
    try {
      const j = JSON.parse(raw) as unknown;
      return Array.isArray(j) ? j.map(String) : null;
    } catch {
      return null;
    }
  }
  return null;
}

export function createPhase3Controller(pool: Pool) {
  return {
    listServiceCategories: async (req: AuthedRequest, res: Response) => {
      const categories = await marketplaceRepo.listServiceCategories(pool);
      const [counts] = await pool.query<RowDataPacket[]>(
        `SELECT category_id, COUNT(*) AS total FROM services WHERE status = 'published' GROUP BY category_id`
      );
      const mapped = categories.map((c) => ({
        ...c,
        serviceCount: counts.find((x) => x.category_id === c.id)?.total ?? 0,
      }));
      res.json({ categories: mapped });
    },

    listPublishedServices: async (req: AuthedRequest, res: Response) => {
      const categoryId =
        typeof req.query.categoryId === "string" && req.query.categoryId.match(/^\d+$/)
          ? Number(req.query.categoryId)
          : undefined;
      const search = typeof req.query.search === "string" ? req.query.search : undefined;
      const rows = await marketplaceRepo.listPublishedServices(pool, { categoryId, search });
      res.json({
        services: rows.map((r) => ({
          id: String(r.id),
          providerUserId: String(r.provider_user_id),
          categoryId: Number(r.category_id),
          eventId: r.event_id != null ? String(r.event_id) : null,
          title: String(r.title),
          description: r.description != null ? String(r.description) : null,
          priceMinor: String(r.price_minor),
          currency: String(r.currency),
          portfolioUrls: parseJsonUrls(r.portfolio_urls),
          coverImageUrl: r.cover_image_url != null ? String(r.cover_image_url) : null,
          imageUrls: marketplaceRepo.parseServiceImageUrls(r.image_urls),
          serviceArea: r.service_area != null ? String(r.service_area) : null,
          leadTimeDays: r.lead_time_days != null ? Number(r.lead_time_days) : null,
          deliveryNotes: r.delivery_notes != null ? String(r.delivery_notes) : null,
          categoryName: String(r.category_name),
          companyName: r.company_name != null ? String(r.company_name) : null,
          yearsInBusiness: r.years_in_business != null ? Number(r.years_in_business) : null,
          organizerRatingAvg: r.organizer_rating_avg != null ? Number(r.organizer_rating_avg) : null,
          organizerRatingCount:
            r.organizer_rating_count != null ? Number(r.organizer_rating_count) : 0,
        })),
      });
    },

    getPublishedService: async (req: AuthedRequest, res: Response) => {
      const id = pid(req.params.serviceId);
      const row = await marketplaceRepo.findPublishedServiceById(pool, id);
      if (!row) throw new HttpError(404, "Service not found");
      const reviews = await marketplaceRepo.listReviewsForService(pool, id);
      res.json({
        service: {
          id: String(row.id),
          providerUserId: String(row.provider_user_id),
          categoryId: Number(row.category_id),
          eventId: row.event_id != null ? String(row.event_id) : null,
          title: String(row.title),
          description: row.description != null ? String(row.description) : null,
          priceMinor: String(row.price_minor),
          currency: String(row.currency),
          portfolioUrls: parseJsonUrls(row.portfolio_urls),
          coverImageUrl: row.cover_image_url != null ? String(row.cover_image_url) : null,
          imageUrls: marketplaceRepo.parseServiceImageUrls(row.image_urls),
          serviceArea: row.service_area != null ? String(row.service_area) : null,
          leadTimeDays: row.lead_time_days != null ? Number(row.lead_time_days) : null,
          deliveryNotes: row.delivery_notes != null ? String(row.delivery_notes) : null,
          categoryName: String(row.category_name),
          companyName: row.company_name != null ? String(row.company_name) : null,
          tagline: row.tagline != null ? String(row.tagline) : null,
          city: row.city != null ? String(row.city) : null,
          state: row.state != null ? String(row.state) : null,
          yearsInBusiness: row.years_in_business != null ? Number(row.years_in_business) : null,
          organizerRatingAvg:
            row.organizer_rating_avg != null ? Number(row.organizer_rating_avg) : null,
          organizerRatingCount:
            row.organizer_rating_count != null ? Number(row.organizer_rating_count) : 0,
        },
        reviews: reviews.map((x) => ({
          id: String(x.id),
          rating: Number(x.rating),
          comment: x.comment != null ? String(x.comment) : null,
          createdAt: x.created_at,
          reviewerName: String(x.reviewer_name),
        })),
      });
    },

    providerGetProfile: async (req: AuthedRequest, res: Response) => {
      const row = await marketplaceRepo.getProviderProfile(pool, req.userId!);
      const orgAgg = await marketplaceRepo.getOrganizerRatingAggregateForProvider(pool, req.userId!);
      res.json({
        profile: row
          ? {
              companyName: String(row.company_name),
              tagline: row.tagline != null ? String(row.tagline) : null,
              city: row.city != null ? String(row.city) : null,
              state: row.state != null ? String(row.state) : null,
              portfolioUrls: parseJsonUrls(row.portfolio_urls),
              bookingEnabled: Boolean(row.booking_enabled),
              publicSlug: row.public_slug != null ? String(row.public_slug) : null,
              yearsInBusiness: row.years_in_business != null ? Number(row.years_in_business) : null,
              organizerRatingAvg: orgAgg.avg,
              organizerRatingCount: orgAgg.count,
            }
          : null,
      });
    },

    providerPutProfile: async (req: AuthedRequest, res: Response) => {
      const body = providerProfileSchema.parse(req.body);
      // Allow any logged-in user to become a service provider by completing this profile.
      // This prevents confusing 403s when users access provider screens without a pre-assigned role.
      const roles = await userRepo.getRoleCodesForUser(pool, req.userId!);
      if (!roles.includes("SERVICE_PROVIDER")) {
        await userRepo.assignRoleByCode(pool, req.userId!, "SERVICE_PROVIDER");
      }
      await marketplaceRepo.upsertProviderProfile(pool, req.userId!, {
        companyName: body.companyName,
        tagline: body.tagline,
        city: body.city,
        state: body.state,
        portfolioUrls: body.portfolioUrls,
        bookingEnabled: body.bookingEnabled,
        publicSlug: body.publicSlug,
        yearsInBusiness: body.yearsInBusiness,
      });
      await auditRepo.insertAuditLog(pool, {
        actorUserId: req.userId!,
        action: "SERVICE_PROVIDER_PROFILE_UPSERT",
        entityType: "service_provider_profile",
        entityId: String(req.userId!),
        metadata: {},
      });
      res.json({ ok: true });
    },

    providerListServices: async (req: AuthedRequest, res: Response) => {
      const rows = await marketplaceRepo.listServicesForProvider(pool, req.userId!);
      res.json({
        services: rows.map((r) => ({
          id: String(r.id),
          categoryId: Number(r.category_id),
          eventId: r.event_id != null ? String(r.event_id) : null,
          title: String(r.title),
          description: r.description != null ? String(r.description) : null,
          priceMinor: String(r.price_minor),
          currency: String(r.currency),
          portfolioUrls: parseJsonUrls(r.portfolio_urls),
          coverImageUrl: r.cover_image_url != null ? String(r.cover_image_url) : null,
          imageUrls: marketplaceRepo.parseServiceImageUrls(r.image_urls),
          serviceArea: r.service_area != null ? String(r.service_area) : null,
          leadTimeDays: r.lead_time_days != null ? Number(r.lead_time_days) : null,
          deliveryNotes: r.delivery_notes != null ? String(r.delivery_notes) : null,
          status: String(r.status),
          categoryName: String(r.category_name),
          updatedAt: r.updated_at,
        })),
      });
    },

    providerCreateService: async (req: AuthedRequest, res: Response) => {
      const body = serviceCreateSchema.parse(req.body);
      await subAccess.assertServiceProviderCanCreateService(pool, req.userId!);
      if (body.status === "published") {
        await subAccess.assertServiceProviderCanPublishNewListing(pool, req.userId!);
      }
      const eventId = body.eventId ? BigInt(body.eventId) : null;
      const id = await marketplaceRepo.insertService(pool, {
        providerUserId: req.userId!,
        categoryId: body.categoryId,
        eventId,
        title: body.title,
        description: body.description ?? null,
        priceMinor: BigInt(body.priceMinor),
        currency: body.currency,
        portfolioUrls: body.portfolioUrls ?? null,
        serviceArea: body.serviceArea ?? null,
        leadTimeDays: body.leadTimeDays ?? null,
        deliveryNotes: body.deliveryNotes ?? null,
        status: body.status,
      });
      if (body.status === "published") {
        await moderationRepo.ensureOpenFlag(pool, { entityType: "service", entityId: String(id) });
      }
      res.status(201).json({ id: String(id) });
    },

    providerPatchService: async (req: AuthedRequest, res: Response) => {
      const serviceId = pid(req.params.serviceId);
      const body = servicePatchSchema.parse(req.body);
      const existing = await marketplaceRepo.findServiceForProvider(pool, serviceId, req.userId!);
      if (!existing) throw new HttpError(404, "Service not found");
      await subAccess.assertServiceProviderAccountReady(pool, req.userId!);
      if (body.status === "published" && String(existing.status) !== "published") {
        await subAccess.assertServiceProviderCanPublishNewListing(pool, req.userId!);
      }
      if (body.removeGalleryUrl) {
        const removed = await marketplaceRepo.removeServiceGalleryUrl(
          pool,
          serviceId,
          req.userId!,
          body.removeGalleryUrl
        );
        if (!removed) throw new HttpError(404, "Service not found");
      }
      const patch: Parameters<typeof marketplaceRepo.updateService>[3] = {};
      if (body.categoryId !== undefined) patch.categoryId = body.categoryId;
      if (body.eventId !== undefined) patch.eventId = body.eventId ? BigInt(body.eventId) : null;
      if (body.title !== undefined) patch.title = body.title;
      if (body.description !== undefined) patch.description = body.description;
      if (body.priceMinor !== undefined) patch.priceMinor = BigInt(body.priceMinor);
      if (body.portfolioUrls !== undefined) patch.portfolioUrls = body.portfolioUrls;
      if (body.status !== undefined) patch.status = body.status;
      if (body.coverImageUrl !== undefined) patch.coverImageUrl = body.coverImageUrl;
      if (body.serviceArea !== undefined) patch.serviceArea = body.serviceArea;
      if (body.leadTimeDays !== undefined) patch.leadTimeDays = body.leadTimeDays;
      if (body.deliveryNotes !== undefined) patch.deliveryNotes = body.deliveryNotes;

      if (Object.keys(patch).length > 0) {
        const ok = await marketplaceRepo.updateService(pool, serviceId, req.userId!, patch);
        if (!ok) throw new HttpError(404, "Service not found");
      }
      if (body.status === "published") {
        await moderationRepo.ensureOpenFlag(pool, { entityType: "service", entityId: String(serviceId) });
      }
      res.json({ ok: true });
    },

    providerUploadServiceImage: async (req: AuthedRequest, res: Response) => {
      const file = (req as AuthedRequest & { file?: { filename: string } }).file;
      if (!file) throw new HttpError(400, "Missing file (use multipart field name \"file\")");
      const serviceId = pid(req.params.serviceId);
      const existing = await marketplaceRepo.findServiceForProvider(pool, serviceId, req.userId!);
      if (!existing) throw new HttpError(404, "Service not found");
      const relativePath = `services/${serviceId}/${file.filename}`;
      const prefix = env.apiPrefix.startsWith("/") ? env.apiPrefix : `/${env.apiPrefix}`;
      const url = `${prefix}/static/uploads/${relativePath}`;
      const ok = await marketplaceRepo.appendServiceImageUrl(pool, serviceId, req.userId!, url);
      if (!ok) throw new HttpError(404, "Service not found");
      res.status(201).json({ url });
    },

    providerListRequests: async (req: AuthedRequest, res: Response) => {
      const st = typeof req.query.status === "string" ? req.query.status : undefined;
      const statusFilter =
        st === "open" || st === "in_progress" || st === "closed" ? st : undefined;
      const rows = await marketplaceRepo.listRequestsForProvider(pool, req.userId!, {
        status: statusFilter,
      });
      res.json({
        requests: rows.map((r) => ({
          id: String(r.id),
          serviceId: String(r.service_id),
          fromUserId: String(r.from_user_id),
          message: String(r.message),
          status: String(r.status),
          providerResponse: r.provider_response != null ? String(r.provider_response) : null,
          createdAt: r.created_at,
          serviceTitle: String(r.service_title),
          fromEmail: String(r.from_email),
          fromName: String(r.from_name),
          contextEventId: r.context_event_id != null ? String(r.context_event_id) : null,
          contextEventTitle: r.context_event_title != null ? String(r.context_event_title) : null,
          contextEventVenue: r.context_event_venue != null ? String(r.context_event_venue) : null,
          contextEventStartsAt: r.context_event_starts_at ?? null,
          contextEventEndsAt: r.context_event_ends_at ?? null,
          latestBookingId: r.latest_booking_id != null ? String(r.latest_booking_id) : null,
          latestBookingStatus: r.latest_booking_status != null ? String(r.latest_booking_status) : null,
          dealStage: marketplaceDealStage({
            contractStatus: r.contract_status,
            bookingStatus: r.latest_booking_status,
            requestStatus: r.status,
          }),
          contractId: r.contract_id != null ? String(r.contract_id) : null,
          contractStatus: r.contract_status != null ? String(r.contract_status) : null,
          contractAcceptedAt: r.contract_accepted_at ?? null,
          contractServiceDescription:
            r.contract_service_description != null ? String(r.contract_service_description) : null,
          contractDurationDays:
            r.contract_duration_days != null ? Number(r.contract_duration_days) : null,
          contractPeopleCount: r.contract_people_count != null ? Number(r.contract_people_count) : null,
        })),
      });
    },

    providerPatchRequest: async (req: AuthedRequest, res: Response) => {
      const requestId = pid(req.params.requestId);
      const body = serviceRequestPatchSchema.parse(req.body);
      const row = await marketplaceRepo.getServiceRequestIfParticipant(pool, requestId, req.userId!);
      if (!row) throw new HttpError(404, "Request not found");
      if (BigInt(String(row.provider_user_id)) !== req.userId!) {
        throw new HttpError(403, "Only the provider can update this enquiry");
      }
      const ok = await marketplaceRepo.patchServiceRequest(pool, requestId, req.userId!, body);
      if (!ok) throw new HttpError(404, "Request not found");
      const reply = body.providerResponse?.trim();
      if (reply) {
        const provider = await userRepo.findUserById(pool, req.userId!);
        emailLater(async () => {
          await emailEnquiryReplyToCustomer(pool, {
            customerUserId: BigInt(String(row.from_user_id)),
            providerName: provider?.full_name ?? "Provider",
            serviceTitle: String(row.service_title),
            replyBody: reply,
            requestId,
          });
        });
      }
      res.json({ ok: true });
    },

    providerCreateBooking: async (req: AuthedRequest, res: Response) => {
      const body = providerBookingCreateSchema.parse(req.body);
      const serviceId = BigInt(body.serviceId);
      const customerUserId = BigInt(body.customerUserId);
      const svc = await marketplaceRepo.findServiceForProvider(pool, serviceId, req.userId!);
      if (!svc) throw new HttpError(404, "Service not found");
      if (customerUserId === req.userId!) throw new HttpError(400, "Invalid customer");
      const reqId = body.serviceRequestId ? BigInt(body.serviceRequestId) : null;
      if (reqId) {
        const rq = await marketplaceRepo.findRequestById(pool, reqId);
        if (!rq || BigInt(String(rq.service_id)) !== serviceId || BigInt(String(rq.from_user_id)) !== customerUserId) {
          throw new HttpError(400, "Request mismatch");
        }
      }
      const scheduledAt = body.scheduledAt ? new Date(body.scheduledAt) : null;
      const bookingId = await marketplaceRepo.insertServiceBooking(pool, {
        serviceRequestId: reqId,
        serviceId,
        customerUserId,
        providerUserId: req.userId!,
        scheduledAt,
        amountMinor: BigInt(body.amountMinor),
        currency: body.currency,
        status: "pending_payment",
      });
      res.status(201).json({ bookingId: String(bookingId) });
    },

    providerListBookings: async (req: AuthedRequest, res: Response) => {
      const eventIdRaw = typeof req.query.eventId === "string" ? req.query.eventId : undefined;
      const contextEventId =
        eventIdRaw && /^\d+$/.test(eventIdRaw) ? BigInt(eventIdRaw) : undefined;
      const rows = await marketplaceRepo.listBookingsForProvider(pool, req.userId!, { contextEventId });
      res.json({
        bookings: rows.map((b) => ({
          id: String(b.id),
          serviceId: String(b.service_id),
          serviceRequestId: b.service_request_id != null ? String(b.service_request_id) : null,
          customerUserId: String(b.customer_user_id),
          amountMinor: String(b.amount_minor),
          currency: String(b.currency),
          status: String(b.status),
          scheduledAt: b.scheduled_at,
          serviceTitle: String(b.service_title),
          customerEmail: String(b.customer_email),
          customerName: String(b.customer_name),
          contextEventId: b.context_event_id != null ? String(b.context_event_id) : null,
          contextEventTitle: b.context_event_title != null ? String(b.context_event_title) : null,
          dealStage: marketplaceDealStage({ bookingStatus: b.status }),
        })),
      });
    },

    providerPatchBooking: async (req: AuthedRequest, res: Response) => {
      const bookingId = pid(req.params.bookingId);
      const body = providerServiceBookingPatchSchema.parse(req.body);
      const scheduledAt =
        body.scheduledAt === undefined
          ? undefined
          : body.scheduledAt === null || body.scheduledAt === ""
            ? null
            : new Date(body.scheduledAt);
      const ok = await marketplaceRepo.patchServiceBookingAsProvider(pool, bookingId, req.userId!, {
        status: body.status,
        scheduledAt,
      });
      if (!ok) throw new HttpError(404, "Booking not found");
      if (body.status === "completed") {
        await marketplaceRepo.closeServiceRequestForCompletedBooking(pool, bookingId, req.userId!);
      }
      res.json({ ok: true });
    },

    providerListPayments: async (req: AuthedRequest, res: Response) => {
      const rows = await marketplaceRepo.listPaymentsForProvider(pool, req.userId!);
      res.json({
        payments: rows.map((x) => ({
          id: String(x.id),
          amountMinor: String(x.amount_minor),
          currency: String(x.currency),
          status: String(x.status),
          createdAt: x.created_at,
          serviceBookingId: String(x.service_booking_id),
          serviceId: String(x.service_id),
          serviceTitle: String(x.service_title),
          razorpayOrderId: x.razorpay_order_id != null ? String(x.razorpay_order_id) : null,
          razorpayPaymentId: x.razorpay_payment_id != null ? String(x.razorpay_payment_id) : null,
          invoiceNumber: x.invoice_number != null ? String(x.invoice_number) : null,
        })),
      });
    },

    providerListReviews: async (req: AuthedRequest, res: Response) => {
      const rows = await marketplaceRepo.listReviewsForProvider(pool, req.userId!);
      const orgRows = await marketplaceRepo.listOrganizerRatingsReceivedByProvider(pool, req.userId!, 100);
      const orgAgg = await marketplaceRepo.getOrganizerRatingAggregateForProvider(pool, req.userId!);
      res.json({
        reviews: rows.map((x) => ({
          id: String(x.id),
          serviceId: String(x.service_id),
          bookingId: String(x.booking_id),
          serviceTitle: String(x.service_title),
          rating: Number(x.rating),
          comment: x.comment != null ? String(x.comment) : null,
          createdAt: x.created_at,
          reviewerName: String(x.reviewer_name),
        })),
        organizerRatings: orgRows.map((x) => ({
          stars: Number(x.stars),
          comment: x.comment != null ? String(x.comment) : null,
          createdAt: x.created_at,
          updatedAt: x.updated_at,
          organizerName: x.organizer_name != null ? String(x.organizer_name) : "Organiser",
        })),
        organizerRatingAvg: orgAgg.avg,
        organizerRatingCount: orgAgg.count,
      });
    },

    customerCreateRequest: async (req: AuthedRequest, res: Response) => {
      const serviceId = pid(req.params.serviceId);
      const body = serviceRequestCreateSchema.parse(req.body);
      const svc = await marketplaceRepo.findServiceById(pool, serviceId);
      if (!svc || svc.status !== "published") throw new HttpError(404, "Service not found");
      if (svc.provider_user_id === req.userId!) throw new HttpError(400, "Cannot enquire on own listing");

      let contextEventId: bigint | null = null;
      const rawEv = body.eventId?.trim();
      if (rawEv) {
        const eid = BigInt(rawEv);
        const ev = await eventRepo.findEventById(pool, eid);
        if (!ev || ev.organizer_user_id !== req.userId!) {
          throw new HttpError(403, "You can only attach events you organize to this enquiry.");
        }
        contextEventId = eid;
      }

      const id = await marketplaceRepo.insertServiceRequest(pool, {
        serviceId,
        fromUserId: req.userId!,
        message: body.message,
        contextEventId,
      });
      const organizer = await userRepo.findUserById(pool, req.userId!);
      let eventTitle: string | null = null;
      if (contextEventId) {
        const ev = await eventRepo.findEventById(pool, contextEventId);
        eventTitle = ev?.title ?? null;
      }
      emailLater(async () => {
        await emailServiceEnquiryToProvider(pool, {
          providerUserId: BigInt(String(svc.provider_user_id)),
          enquirerName: organizer?.full_name ?? "Customer",
          enquirerEmail: organizer?.email ?? "",
          serviceTitle: String(svc.title),
          message: body.message,
          eventTitle,
          requestId: id,
        });
      });
      res.status(201).json({ id: String(id) });
    },

    customerListRequests: async (req: AuthedRequest, res: Response) => {
      const rows = await marketplaceRepo.listRequestsByCustomer(pool, req.userId!);
      res.json({
        requests: rows.map((r) => ({
          id: String(r.id),
          serviceId: String(r.service_id),
          message: String(r.message),
          status: String(r.status),
          providerResponse: r.provider_response != null ? String(r.provider_response) : null,
          createdAt: r.created_at,
          serviceTitle: String(r.service_title),
          contextEventId: r.context_event_id != null ? String(r.context_event_id) : null,
          contextEventTitle: r.context_event_title != null ? String(r.context_event_title) : null,
          latestBookingId: r.latest_booking_id != null ? String(r.latest_booking_id) : null,
          latestBookingStatus: r.latest_booking_status != null ? String(r.latest_booking_status) : null,
          dealStage: marketplaceDealStage({
            contractStatus: r.contract_status,
            bookingStatus: r.latest_booking_status,
            requestStatus: r.status,
          }),
          contractId: r.contract_id != null ? String(r.contract_id) : null,
          contractStatus: r.contract_status != null ? String(r.contract_status) : null,
        })),
      });
    },

    organizerSendServiceContract: async (req: AuthedRequest, res: Response) => {
      const requestId = pid(req.params.requestId);
      const body = serviceRequestContractSendSchema.parse(req.body);
      const row = await marketplaceRepo.getServiceRequestIfParticipant(pool, requestId, req.userId!);
      if (!row) throw new HttpError(404, "Thread not found");
      if (BigInt(String(row.from_user_id)) !== req.userId!) {
        throw new HttpError(403, "Only the enquirer (organiser) can send a contract");
      }
      const roles = await userRepo.getRoleCodesForUser(pool, req.userId!);
      if (!roles.includes("ORGANIZER")) throw new HttpError(403, "Only organisers can send service contracts");
      const existing = await marketplaceRepo.findContractByRequestId(pool, requestId);
      if (existing) {
        const st = marketplaceRepo.normalizeContractStatus(existing.status);
        if (st === "accepted") throw new HttpError(400, "Contract already accepted — deal is done");
        if (st === "pending_acceptance") throw new HttpError(400, "Contract already sent — waiting for provider");
        await marketplaceRepo.deleteContractForRequest(pool, requestId);
      }
      const contractId = await marketplaceRepo.insertServiceRequestContract(pool, {
        serviceRequestId: requestId,
        organizerUserId: req.userId!,
        providerUserId: BigInt(String(row.provider_user_id)),
        serviceDescription: contractServiceLineFromRequest(row),
        durationDays: body.durationDays,
        peopleCount: body.peopleCount,
        organizerNotes: body.organizerNotes?.trim() || null,
      });
      if (String(row.status) === "open") {
        await marketplaceRepo.touchServiceRequestInProgress(pool, requestId);
      }
      const organizer = await userRepo.findUserById(pool, req.userId!);
      const serviceDescription = contractServiceLineFromRequest(row);
      emailLater(async () => {
        await emailContractSentToProvider(pool, {
          providerUserId: BigInt(String(row.provider_user_id)),
          organizerName: organizer?.full_name ?? "Organiser",
          serviceDescription,
          durationDays: body.durationDays,
          peopleCount: body.peopleCount,
          eventTitle: row.context_event_title != null ? String(row.context_event_title) : null,
          requestId,
        });
      });
      res.status(201).json({ contractId: String(contractId), status: "pending_acceptance" });
    },

    providerAcceptServiceContract: async (req: AuthedRequest, res: Response) => {
      const requestId = pid(req.params.requestId);
      const body = serviceRequestContractAcceptSchema.parse(req.body);
      const row = await marketplaceRepo.getServiceRequestIfParticipant(pool, requestId, req.userId!);
      if (!row) throw new HttpError(404, "Thread not found");
      if (BigInt(String(row.provider_user_id)) !== req.userId!) {
        throw new HttpError(403, "Only the service provider can accept this contract");
      }
      const contract = await marketplaceRepo.findContractByRequestId(pool, requestId);
      if (!contract) throw new HttpError(404, "No contract sent yet");
      const contractStatus = marketplaceRepo.normalizeContractStatus(contract.status);
      if (contractStatus === "accepted") {
        res.json({ ok: true, status: "accepted", dealStage: "deal_done", alreadyAccepted: true });
        return;
      }
      if (contractStatus !== "pending_acceptance") {
        throw new HttpError(
          400,
          contractStatus === "declined"
            ? "Contract decline ho chuka hai — organiser se naya contract maangein."
            : contractStatus === "cancelled"
              ? "Contract cancel ho chuka hai — organiser se dubara bhejne ko kahein."
              : "Contract ab accept ke liye available nahi hai."
        );
      }
      const ok = await marketplaceRepo.acceptServiceRequestContract(pool, requestId, req.userId!, {
        manpowerAvailable: body.manpowerAvailable,
        machinery: body.machinery.map((m) => ({
          name: m.name.trim(),
          count: m.count,
          details: m.details?.trim() || null,
        })),
        providerNotes: body.providerNotes?.trim() || null,
      });
      if (!ok) throw new HttpError(400, "Could not accept contract");
      await marketplaceRepo.insertServiceRequestMessage(pool, {
        requestId,
        fromUserId: req.userId!,
        body: "Contract accepted — service is confirmed for this fair.",
      });
      const organizer = await userRepo.findUserById(pool, BigInt(String(row.from_user_id)));
      const provider = await userRepo.findUserById(pool, req.userId!);
      emailLater(async () => {
        await emailContractAccepted(pool, {
          organizerUserId: BigInt(String(row.from_user_id)),
          providerUserId: req.userId!,
          organizerName: organizer?.full_name ?? "Organiser",
          providerName: provider?.full_name ?? "Provider",
          serviceDescription: contractServiceLineFromRequest(row),
          eventTitle: row.context_event_title != null ? String(row.context_event_title) : null,
          requestId,
        });
      });
      res.json({ ok: true, status: "accepted", dealStage: "deal_done" });
    },

    providerDeclineServiceContract: async (req: AuthedRequest, res: Response) => {
      const requestId = pid(req.params.requestId);
      const body = serviceRequestContractDeclineSchema.parse(req.body ?? {});
      const row = await marketplaceRepo.getServiceRequestIfParticipant(pool, requestId, req.userId!);
      if (!row) throw new HttpError(404, "Thread not found");
      if (BigInt(String(row.provider_user_id)) !== req.userId!) {
        throw new HttpError(403, "Only the service provider can decline this contract");
      }
      const contract = await marketplaceRepo.findContractByRequestId(pool, requestId);
      if (!contract) throw new HttpError(404, "No contract sent yet");
      const contractStatus = marketplaceRepo.normalizeContractStatus(contract.status);
      if (contractStatus === "declined") {
        res.json({ ok: true, status: "declined", alreadyDeclined: true });
        return;
      }
      if (contractStatus !== "pending_acceptance") {
        throw new HttpError(400, "Contract is not waiting for your response");
      }
      const ok = await marketplaceRepo.declineServiceRequestContract(
        pool,
        requestId,
        req.userId!,
        body.providerNotes?.trim() || null
      );
      if (!ok) throw new HttpError(400, "Could not decline contract");
      const organizer = await userRepo.findUserById(pool, BigInt(String(row.from_user_id)));
      const provider = await userRepo.findUserById(pool, req.userId!);
      emailLater(async () => {
        await emailContractDeclined(pool, {
          organizerUserId: BigInt(String(row.from_user_id)),
          providerUserId: req.userId!,
          organizerName: organizer?.full_name ?? "Organiser",
          providerName: provider?.full_name ?? "Provider",
          serviceDescription: contractServiceLineFromRequest(row),
          eventTitle: row.context_event_title != null ? String(row.context_event_title) : null,
          requestId,
          declineNote: body.providerNotes?.trim() || null,
        });
      });
      res.json({ ok: true, status: "declined" });
    },

    organizerListAcceptedContracts: async (req: AuthedRequest, res: Response) => {
      const rows = await marketplaceRepo.listOrganizerAcceptedContracts(pool, req.userId!);
      res.json({
        contracts: rows.map((r) => ({
          contractId: String(r.contract_id),
          requestId: String(r.request_id),
          acceptedAt: r.accepted_at,
          serviceTitle: String(r.service_title),
          serviceDescription: String(r.service_description),
          durationDays: Number(r.duration_days),
          peopleCount: Number(r.people_count),
          providerDisplayName: String(r.provider_display_name),
          eventId: r.event_id != null ? String(r.event_id) : null,
          eventTitle: r.event_title != null ? String(r.event_title) : null,
          eventVenue: r.event_venue != null ? String(r.event_venue) : null,
          eventStartsAt: r.event_starts_at ?? null,
          eventEndsAt: r.event_ends_at ?? null,
        })),
      });
    },

    providerListAcceptedContracts: async (req: AuthedRequest, res: Response) => {
      const rows = await marketplaceRepo.listProviderAcceptedContracts(pool, req.userId!);
      res.json({
        contracts: rows.map((r) => ({
          contractId: String(r.contract_id),
          requestId: String(r.request_id),
          serviceId: String(r.service_id),
          acceptedAt: r.accepted_at,
          serviceTitle: String(r.service_title),
          serviceDescription: String(r.service_description),
          durationDays: Number(r.duration_days),
          peopleCount: Number(r.people_count),
          manpowerAvailable: r.manpower_available != null ? Number(r.manpower_available) : null,
          organizerDisplayName: String(r.organizer_display_name),
          eventId: r.event_id != null ? String(r.event_id) : null,
          eventTitle: r.event_title != null ? String(r.event_title) : null,
          eventVenue: r.event_venue != null ? String(r.event_venue) : null,
          eventStartsAt: r.event_starts_at ?? null,
          eventEndsAt: r.event_ends_at ?? null,
          bookingId: r.booking_id != null ? String(r.booking_id) : null,
          bookingStatus: r.booking_status != null ? String(r.booking_status) : null,
          amountMinor: r.amount_minor != null ? String(r.amount_minor) : null,
          currency: r.currency != null ? String(r.currency) : null,
        })),
      });
    },

    providerGetAcceptedContract: async (req: AuthedRequest, res: Response) => {
      const contractId = pid(req.params.contractId);
      const row = await marketplaceRepo.getProviderAcceptedContractDetail(pool, contractId, req.userId!);
      if (!row) throw new HttpError(404, "Contract not found");
      const contract = serializeContract(row);
      res.json({
        contractId: String(row.id),
        requestId: String(row.request_id),
        serviceId: String(row.service_id),
        enquiryMessage: String(row.enquiry_message),
        requestStatus: String(row.request_status),
        organizer: {
          userId: String(row.organizer_user_id),
          name: row.organizer_name != null ? String(row.organizer_name) : null,
          email: String(row.organizer_email),
          phone: row.organizer_phone != null ? String(row.organizer_phone) : null,
        },
        serviceListing: {
          title: String(row.service_title),
          categoryName: row.category_name != null ? String(row.category_name) : null,
          description:
            row.service_description != null && String(row.service_description).trim()
              ? String(row.service_description)
              : null,
        },
        contextEvent:
          row.event_id != null
            ? {
                id: String(row.event_id),
                title: row.event_title != null ? String(row.event_title) : null,
                venue: row.event_venue != null ? String(row.event_venue) : null,
                startsAt: row.event_starts_at ?? null,
                endsAt: row.event_ends_at ?? null,
              }
            : null,
        contract,
        booking:
          row.booking_id != null
            ? {
                id: String(row.booking_id),
                status: String(row.booking_status),
                amountMinor: String(row.booking_amount_minor),
                currency: String(row.booking_currency),
                scheduledAt: row.booking_scheduled_at ?? null,
                createdAt: row.booking_created_at,
              }
            : null,
        dealStage: "deal_done",
      });
    },

    listServiceRequestThread: async (req: AuthedRequest, res: Response) => {
      const requestId = pid(req.params.requestId);
      const row = await marketplaceRepo.getServiceRequestIfParticipant(pool, requestId, req.userId!);
      if (!row) throw new HttpError(404, "Thread not found");
      const msgs = await marketplaceRepo.listServiceRequestMessages(pool, requestId);
      const isCustomer = BigInt(String(row.from_user_id)) === req.userId!;
      const roles = await userRepo.getRoleCodesForUser(pool, req.userId!);
      const viewerIsOrganizer = roles.includes("ORGANIZER");
      const providerUserId = BigInt(String(row.provider_user_id));
      const orgAgg = await marketplaceRepo.getOrganizerRatingAggregateForProvider(pool, providerUserId);
      let myOrganizerRating: { stars: number; comment: string | null } | null = null;
      if (isCustomer && viewerIsOrganizer) {
        myOrganizerRating = await marketplaceRepo.getOrganizerProviderRatingRow(pool, req.userId!, providerUserId);
      }
      const contractRow = await marketplaceRepo.findContractByRequestId(pool, requestId);
      const contract = serializeContract(contractRow);
      const viewerMaySendContract = isCustomer && viewerIsOrganizer && (!contract || contract.status === "declined" || contract.status === "cancelled");
      const contractStatusNorm = contract
        ? marketplaceRepo.normalizeContractStatus(contract.status)
        : null;
      const viewerMayAcceptContract = !isCustomer && contractStatusNorm === "pending_acceptance";
      res.json({
        request: {
          id: String(row.id),
          serviceId: String(row.service_id),
          serviceTitle: String(row.service_title),
          status: String(row.status),
          createdAt: row.created_at,
        },
        serviceListing: {
          title: String(row.service_title),
          categoryName: row.category_name != null ? String(row.category_name) : null,
          description:
            row.service_description != null && String(row.service_description).trim()
              ? String(row.service_description).length > 280
                ? `${String(row.service_description).slice(0, 277)}…`
                : String(row.service_description)
              : null,
        },
        viewerIsCustomer: isCustomer,
        customerLabel:
          row.customer_name != null && String(row.customer_name).trim()
            ? String(row.customer_name)
            : row.customer_email != null
              ? String(row.customer_email)
              : "Customer",
        initial: {
          body: String(row.message),
          createdAt: row.created_at,
          fromUserId: String(row.from_user_id),
        },
        messages: msgs.map((m) => ({
          id: String(m.id),
          fromUserId: String(m.from_user_id),
          fromName: m.from_name != null ? String(m.from_name) : null,
          body: String(m.body),
          createdAt: m.created_at,
        })),
        provider: {
          userId: String(providerUserId),
          displayName:
            row.provider_display_name != null && String(row.provider_display_name).trim()
              ? String(row.provider_display_name)
              : "Provider",
          yearsInBusiness:
            row.provider_years_in_business != null ? Number(row.provider_years_in_business) : null,
          organizerRatingAvg: orgAgg.avg,
          organizerRatingCount: orgAgg.count,
        },
        viewerMayRateAsOrganizer: isCustomer && viewerIsOrganizer,
        myOrganizerRating,
        contract,
        viewerMaySendContract,
        viewerMayAcceptContract,
        dealStage: marketplaceDealStage({
          contractStatus: contract?.status,
          requestStatus: row.status,
        }),
        contextEvent:
          row.context_event_id != null
            ? {
                id: String(row.context_event_id),
                title: row.context_event_title != null ? String(row.context_event_title) : null,
                venue: row.context_event_venue != null ? String(row.context_event_venue) : null,
                startsAt: row.context_event_starts_at ?? null,
                endsAt: row.context_event_ends_at ?? null,
              }
            : null,
      });
    },

    organizerUpsertProviderRating: async (req: AuthedRequest, res: Response) => {
      const providerUserId = pid(req.params.providerUserId);
      const body = organizerProviderRatingSchema.parse(req.body);
      const roles = await userRepo.getRoleCodesForUser(pool, req.userId!);
      if (!roles.includes("ORGANIZER")) throw new HttpError(403, "Only organisers can submit this rating");
      const eligible = await marketplaceRepo.organizerHasEnquiredWithProvider(pool, req.userId!, providerUserId);
      if (!eligible) throw new HttpError(403, "Send at least one service enquiry to this provider before rating them");
      await marketplaceRepo.upsertOrganizerProviderRating(pool, {
        organizerUserId: req.userId!,
        providerUserId,
        stars: body.stars,
        comment: body.comment ?? null,
      });
      res.json({ ok: true });
    },

    postServiceRequestMessage: async (req: AuthedRequest, res: Response) => {
      const requestId = pid(req.params.requestId);
      const body = serviceRequestMessageCreateSchema.parse(req.body);
      const row = await marketplaceRepo.getServiceRequestIfParticipant(pool, requestId, req.userId!);
      if (!row) throw new HttpError(404, "Thread not found");
      if (String(row.status) === "closed") throw new HttpError(400, "This enquiry is closed");
      await marketplaceRepo.insertServiceRequestMessage(pool, {
        requestId,
        fromUserId: req.userId!,
        body: body.body.trim(),
      });
      if (String(row.status) === "open") {
        await marketplaceRepo.touchServiceRequestInProgress(pool, requestId);
      }
      const toUserId =
        BigInt(String(row.from_user_id)) === req.userId!
          ? BigInt(String(row.provider_user_id))
          : BigInt(String(row.from_user_id));
      const fromUser = await userRepo.findUserById(pool, req.userId!);
      emailLater(async () => {
        await emailServiceRequestMessage(pool, {
          toUserId,
          fromName: fromUser?.full_name ?? "User",
          serviceTitle: String(row.service_title),
          messageBody: body.body.trim(),
          requestId,
        });
      });
      res.status(201).json({ ok: true });
    },

    customerListBookings: async (req: AuthedRequest, res: Response) => {
      const rows = await marketplaceRepo.listBookingsForCustomer(pool, req.userId!);
      res.json({
        bookings: rows.map((b) => ({
          id: String(b.id),
          serviceId: String(b.service_id),
          amountMinor: String(b.amount_minor),
          currency: String(b.currency),
          status: String(b.status),
          scheduledAt: b.scheduled_at,
          serviceTitle: String(b.service_title),
        })),
      });
    },

    customerCreatePayOrder: async (req: AuthedRequest, res: Response) => {
      const bookingId = pid(req.params.bookingId);
      const b = await marketplaceRepo.findServiceBookingForUser(pool, bookingId, req.userId!);
      if (!b) throw new HttpError(404, "Booking not found");
      if (String(b.customer_user_id) !== String(req.userId!)) throw new HttpError(403, "Forbidden");
      if (String(b.status) !== "pending_payment") throw new HttpError(400, "Booking not awaiting payment");
      const svc = await marketplaceRepo.findServiceById(pool, BigInt(String(b.service_id)));
      if (!svc) throw new HttpError(404, "Service not found");
      const commissionBps = 0;
      const gross = BigInt(String(b.amount_minor));
      const platformFee = 0n;
      const receipt = `sb_${bookingId}`;
      const rz = await razorpay.createOrder(Number(gross), String(b.currency), receipt);
      await marketplaceRepo.setServiceBookingRazorpayOrder(pool, bookingId, rz.orderId);
      res.status(201).json({
        razorpayOrderId: rz.orderId,
        razorpayKeyId: process.env.RAZORPAY_KEY_ID ?? "",
        amountMinor: String(gross),
        currency: String(b.currency),
        commissionBps,
        platformFeeMinor: String(platformFee),
      });
    },

    customerVerifyServiceBookingPay: async (req: AuthedRequest, res: Response) => {
      const bookingId = pid(req.params.bookingId);
      const body = verifyRazorpaySchema.parse(req.body);
      const b = await marketplaceRepo.findServiceBookingForUser(pool, bookingId, req.userId!);
      if (!b) throw new HttpError(404, "Booking not found");
      if (String(b.customer_user_id) !== String(req.userId!)) throw new HttpError(403, "Forbidden");
      if (String(b.status) !== "pending_payment") throw new HttpError(400, "Booking not awaiting payment");
      if (b.razorpay_order_id && String(b.razorpay_order_id) !== body.razorpayOrderId) {
        throw new HttpError(400, "Order id mismatch");
      }
      const ok = razorpay.verifyPaymentSignature(
        body.razorpayOrderId,
        body.razorpayPaymentId,
        body.razorpaySignature
      );
      if (!ok) throw new HttpError(400, "Invalid payment signature");
      const gross = BigInt(String(b.amount_minor));
      const confirmed = await marketplaceRepo.confirmServiceBookingPayment(pool, bookingId);
      if (!confirmed) throw new HttpError(400, "Could not confirm booking");
      await insertServiceBookingPaymentRecord(pool, {
        payerUserId: req.userId!,
        amountMinor: gross,
        razorpayOrderId: body.razorpayOrderId,
        razorpayPaymentId: body.razorpayPaymentId,
        serviceBookingId: bookingId,
        metadata: {
          commissionBps: 0,
          platformFeeMinor: "0",
        },
      });
      res.json({ ok: true });
    },

    customerCreateReview: async (req: AuthedRequest, res: Response) => {
      const bookingId = pid(req.params.bookingId);
      const body = serviceReviewCreateSchema.parse(req.body);
      const b = await marketplaceRepo.findServiceBookingForUser(pool, bookingId, req.userId!);
      if (!b) throw new HttpError(404, "Booking not found");
      if (String(b.customer_user_id) !== String(req.userId!)) throw new HttpError(403, "Forbidden");
      if (String(b.status) !== "completed") throw new HttpError(400, "Complete the booking before reviewing");
      const serviceId = BigInt(String(b.service_id));
      await marketplaceRepo.insertServiceReview(pool, {
        serviceId,
        bookingId,
        reviewerUserId: req.userId!,
        rating: body.rating,
        comment: body.comment ?? null,
      });
      res.status(201).json({ ok: true });
    },

    adminListSubscriptionPlans: async (_req: AuthedRequest, res: Response) => {
      const rows = await marketplaceRepo.listSubscriptionPlans(pool);
      res.json({
        plans: rows.map((p) => ({
          id: Number(p.id),
          name: String(p.name),
          description: p.description != null ? String(p.description) : null,
          priceMinor: String(p.price_minor),
          durationDays: Number(p.duration_days),
          active: Boolean(p.active),
          targetRoleCode: String(p.target_role_code ?? "ORGANIZER"),
          limitations:
            p.limitations_json == null
              ? null
              : typeof p.limitations_json === "string"
                ? JSON.parse(p.limitations_json)
                : p.limitations_json,
          stallBookingCommissionBps: Number(p.stall_booking_commission_bps ?? 0),
          createdAt: p.created_at,
        })),
      });
    },

    adminPutSubscriptionPlan: async (req: AuthedRequest, res: Response) => {
      const body = subscriptionPlanSchema.parse(req.body);
      const id = await marketplaceRepo.upsertSubscriptionPlan(pool, {
        id: body.id,
        name: body.name,
        description: body.description ?? null,
        priceMinor: BigInt(body.priceMinor),
        durationDays: body.durationDays,
        active: body.active,
        targetRoleCode: body.targetRoleCode,
        limitationsJson: body.limitations ?? null,
        stallBookingCommissionBps: body.stallBookingCommissionBps ?? 0,
      });
      res.json({ id });
    },

    adminDeleteSubscriptionPlan: async (req: AuthedRequest, res: Response) => {
      const id = Number(String(req.params.planId ?? ""));
      if (!Number.isFinite(id) || id <= 0) throw new HttpError(400, "Invalid plan id");
      const r = await marketplaceRepo.deleteSubscriptionPlanById(pool, id);
      if (r === "in_use") throw new HttpError(409, "Plan is referenced by subscriptions; set active=false instead");
      if (r === "not_found") throw new HttpError(404, "Plan not found");
      res.json({ ok: true });
    },

    adminSubscribeUser: async (req: AuthedRequest, res: Response) => {
      const body = adminSubscribeUserSchema.parse(req.body);
      const userId = BigInt(body.userId);
      const plan = await marketplaceRepo.findSubscriptionPlanById(pool, body.planId);
      if (!plan || !Number(plan.active)) throw new HttpError(404, "Plan not found or inactive");
      const targetRole = String(plan.target_role_code ?? "ORGANIZER").toUpperCase();
      const roles = await userRepo.getRoleCodesForUser(pool, userId);
      if (!roles.includes(targetRole)) {
        throw new HttpError(400, `User must have the ${targetRole} role to receive this plan.`);
      }
      const days = Number(plan.duration_days);
      const starts = new Date();
      const ends = new Date(starts.getTime() + days * 86400000);
      await marketplaceRepo.expireActiveSubscriptionsForUserAndRole(pool, userId, targetRole);
      const subId = await marketplaceRepo.insertSubscription(pool, {
        userId,
        planId: body.planId,
        startsAt: starts,
        endsAt: ends,
      });
      await auditRepo.insertAuditLog(pool, {
        actorUserId: req.userId!,
        action: "ADMIN_SUBSCRIPTION_GRANT",
        entityType: "subscription",
        entityId: String(subId),
        metadata: { userId: String(userId), planId: body.planId },
      });
      res.status(201).json({ subscriptionId: String(subId) });
    },

    listPublicSubscriptionPlans: async (req: AuthedRequest, res: Response) => {
      const raw = typeof req.query.roleCode === "string" ? req.query.roleCode.trim().toUpperCase() : "ORGANIZER";
      const rc = raw === "SERVICE_PROVIDER" ? "SERVICE_PROVIDER" : "ORGANIZER";
      const rows = await marketplaceRepo.listActivePlansForRole(pool, rc);
      res.json({
        plans: rows.map((p) => ({
          id: Number(p.id),
          name: String(p.name),
          description: p.description != null ? String(p.description) : null,
          priceMinor: String(p.price_minor),
          durationDays: Number(p.duration_days),
          targetRoleCode: String(p.target_role_code),
          limitations:
            p.limitations_json == null
              ? null
              : typeof p.limitations_json === "string"
                ? JSON.parse(p.limitations_json)
                : p.limitations_json,
          stallBookingCommissionBps: Number(p.stall_booking_commission_bps ?? 0),
        })),
      });
    },

    subscriptionValidateReferral: async (req: AuthedRequest, res: Response) => {
      if (!req.userId) throw new HttpError(401, "Unauthorized");
      const body = subscriptionReferralValidateSchema.parse(req.body);
      const planRow = await marketplaceRepo.findSubscriptionPlanById(pool, body.planId);
      if (!planRow || !Number(planRow.active)) throw new HttpError(404, "Plan not found or inactive");
      const targetRole = String(planRow.target_role_code ?? "ORGANIZER").toUpperCase();
      const roles = await userRepo.getRoleCodesForUser(pool, req.userId!);
      if (!roles.includes(targetRole)) throw new HttpError(403, `This plan is for ${targetRole} accounts only.`);
      const priceMinor = BigInt(String(planRow.price_minor));
      const quote = await resolveReferralForSubscription(pool, {
        code: body.referralCode.trim(),
        userId: req.userId!,
        targetRoleCode: targetRole,
        planId: body.planId,
        priceMinor,
      });
      res.json({
        label: quote.label,
        discountLabel: quote.discountLabel,
        originalAmountMinor: String(quote.originalAmountMinor),
        finalAmountMinor: String(quote.finalAmountMinor),
        discountMinor: String(quote.discountMinor),
        code: quote.code,
      });
    },

    subscriptionCheckout: async (req: AuthedRequest, res: Response) => {
      if (!req.userId) throw new HttpError(401, "Unauthorized");
      const body = subscriptionCheckoutSchema.parse(req.body);
      const planRow = await marketplaceRepo.findSubscriptionPlanById(pool, body.planId);
      if (!planRow || !Number(planRow.active)) throw new HttpError(404, "Plan not found or inactive");
      const targetRole = String(planRow.target_role_code ?? "ORGANIZER").toUpperCase();
      const roles = await userRepo.getRoleCodesForUser(pool, req.userId!);
      if (!roles.includes(targetRole)) throw new HttpError(403, `This plan is for ${targetRole} accounts only.`);
      const priceMinor = BigInt(String(planRow.price_minor));
      let chargeMinor = priceMinor;
      let referralLabel: string | null = null;
      let referralMeta: Record<string, string | number> = {};
      const codeInput = body.referralCode?.trim();
      if (codeInput) {
        const quote = await resolveReferralForSubscription(pool, {
          code: codeInput,
          userId: req.userId!,
          targetRoleCode: targetRole,
          planId: body.planId,
          priceMinor,
        });
        chargeMinor = quote.finalAmountMinor;
        referralLabel = quote.label;
        referralMeta = {
          referralCodeId: quote.referralCodeId,
          originalAmountMinor: String(quote.originalAmountMinor),
          discountMinor: String(quote.discountMinor),
        };
      }
      const days = Number(planRow.duration_days);
      const starts = new Date();
      const ends = new Date(starts.getTime() + days * 86400000);

      if (chargeMinor === 0n) {
        await marketplaceRepo.expireActiveSubscriptionsForUserAndRole(pool, req.userId!, targetRole);
        const subId = await marketplaceRepo.insertSubscription(pool, {
          userId: req.userId!,
          planId: body.planId,
          startsAt: starts,
          endsAt: ends,
        });
        await auditRepo.insertAuditLog(pool, {
          actorUserId: req.userId!,
          action: "SUBSCRIPTION_ACTIVATED_FREE",
          entityType: "subscription",
          entityId: String(subId),
          metadata: { planId: body.planId },
        });
        return res.status(201).json({ ok: true, free: true, subscriptionId: String(subId) });
      }

      const paymentId = await paymentRepo.insertPayment(pool, {
        payerUserId: req.userId!,
        amountMinor: chargeMinor,
        currency: "INR",
        status: "created",
        razorpayOrderId: null,
        razorpayPaymentId: null,
        bookingId: null,
        ticketOrderId: null,
        serviceBookingId: null,
        metadata: { kind: "subscription_plan", planId: body.planId, ...referralMeta },
      });
      const rz = await razorpay.createOrder(Number(chargeMinor), "INR", `subp_${paymentId}`);
      await paymentRepo.updatePaymentRazorpayOrderId(pool, paymentId, rz.orderId);
      res.status(201).json({
        paymentId: String(paymentId),
        razorpayOrderId: rz.orderId,
        razorpayKeyId: process.env.RAZORPAY_KEY_ID ?? "",
        planId: body.planId,
        amountMinor: String(chargeMinor),
        originalAmountMinor: referralMeta.originalAmountMinor ?? String(priceMinor),
        discountMinor: referralMeta.discountMinor ?? "0",
        referralLabel,
      });
    },

    subscriptionVerify: async (req: AuthedRequest, res: Response) => {
      if (!req.userId) throw new HttpError(401, "Unauthorized");
      const body = subscriptionVerifySchema.parse(req.body);
      const paymentId = BigInt(body.paymentId);
      const pay = await paymentRepo.findPaymentById(pool, paymentId);
      if (!pay || BigInt(String(pay.payer_user_id)) !== req.userId!) throw new HttpError(404, "Payment not found");
      if (String(pay.razorpay_order_id) !== body.razorpayOrderId) throw new HttpError(400, "Order mismatch");
      const metaRaw = pay.metadata;
      const meta =
        typeof metaRaw === "string"
          ? (JSON.parse(metaRaw) as Record<string, unknown>)
          : (metaRaw as Record<string, unknown> | null);
      if (!meta || meta.kind !== "subscription_plan") throw new HttpError(400, "Invalid payment");
      const planId = Number(meta.planId);
      if (!Number.isFinite(planId) || planId <= 0) throw new HttpError(400, "Invalid plan on payment");

      const plan = await marketplaceRepo.findSubscriptionPlanById(pool, planId);
      if (!plan) throw new HttpError(404, "Plan not found");
      const targetRole = String(plan.target_role_code ?? "ORGANIZER").toUpperCase();

      if (String(pay.status) === "captured") {
        const sub = await marketplaceRepo.findActiveSubscriptionForRole(pool, req.userId!, targetRole);
        return res.json({ ok: true, subscriptionId: sub ? String(sub.id) : null, idempotent: true });
      }

      const ok = razorpay.verifyPaymentSignature(body.razorpayOrderId, body.razorpayPaymentId, body.razorpaySignature);
      if (!ok) throw new HttpError(400, "Invalid signature");

      const days = Number(plan.duration_days);
      const starts = new Date();
      const ends = new Date(starts.getTime() + days * 86400000);
      await marketplaceRepo.expireActiveSubscriptionsForUserAndRole(pool, req.userId!, targetRole);
      const subId = await marketplaceRepo.insertSubscription(pool, {
        userId: req.userId!,
        planId,
        startsAt: starts,
        endsAt: ends,
      });
      await paymentRepo.updatePaymentCaptured(pool, paymentId, body.razorpayPaymentId);
      await ensureInvoiceForPayment(pool, paymentId);
      emailLater(() => notifyAfterPaymentRecorded(pool, paymentId));

      const referralCodeId = meta.referralCodeId != null ? Number(meta.referralCodeId) : null;
      if (referralCodeId && Number.isFinite(referralCodeId)) {
        const originalMinor = BigInt(String(meta.originalAmountMinor ?? pay.amount_minor));
        const discountMinor = BigInt(String(meta.discountMinor ?? "0"));
        const paidMinor = BigInt(String(pay.amount_minor));
        const already = await referralRepo.userHasRedeemedCode(pool, req.userId!, referralCodeId);
        if (!already) {
          await referralRepo.insertReferralRedemption(pool, {
            referralCodeId,
            userId: req.userId!,
            planId,
            paymentId,
            subscriptionId: subId,
            originalAmountMinor: originalMinor,
            discountMinor,
            amountPaidMinor: paidMinor,
          });
        }
      }

      await auditRepo.insertAuditLog(pool, {
        actorUserId: req.userId!,
        action: "SUBSCRIPTION_PURCHASED",
        entityType: "subscription",
        entityId: String(subId),
        metadata: { planId, paymentId: String(paymentId), referralCodeId: meta.referralCodeId ?? null },
      });
      res.json({ ok: true, subscriptionId: String(subId) });
    },

    adminListReferralCodes: async (_req: AuthedRequest, res: Response) => {
      const rows = await referralRepo.listReferralCodes(pool);
      res.json({
        codes: rows.map((r) => ({
          id: Number(r.id),
          code: String(r.code),
          label: String(r.label),
          targetRoleCode: String(r.target_role_code),
          discountType: String(r.discount_type),
          discountValue: Number(r.discount_value),
          maxRedemptions: r.max_redemptions != null ? Number(r.max_redemptions) : null,
          redemptionCount: Number(r.redemption_count),
          validFrom: r.valid_from ?? null,
          validUntil: r.valid_until ?? null,
          active: Boolean(Number(r.active)),
          createdAt: r.created_at,
        })),
      });
    },

    adminUpsertReferralCode: async (req: AuthedRequest, res: Response) => {
      const body = referralCodeUpsertSchema.parse(req.body);
      const existing = await referralRepo.findReferralCodeByCode(pool, body.code);
      if (existing && (!body.id || Number(existing.id) !== body.id)) {
        throw new HttpError(409, "Referral code already exists");
      }
      const id = await referralRepo.upsertReferralCode(pool, {
        id: body.id,
        code: body.code,
        label: body.label,
        targetRoleCode: body.targetRoleCode,
        discountType: body.discountType,
        discountValue: body.discountValue,
        maxRedemptions: body.maxRedemptions ?? null,
        validFrom: body.validFrom?.trim() ? new Date(body.validFrom) : null,
        validUntil: body.validUntil?.trim() ? new Date(body.validUntil) : null,
        active: body.active,
        createdByUserId: body.id ? null : req.userId!,
      });
      await auditRepo.insertAuditLog(pool, {
        actorUserId: req.userId!,
        action: body.id ? "ADMIN_REFERRAL_CODE_UPDATE" : "ADMIN_REFERRAL_CODE_CREATE",
        entityType: "referral_code",
        entityId: String(id),
        metadata: { code: body.code, label: body.label },
      });
      res.json({ id });
    },

    adminSetReferralCodeActive: async (req: AuthedRequest, res: Response) => {
      const id = Number(pid(req.params.id));
      const active = req.body?.active === undefined ? true : Boolean(req.body.active);
      const ok = await referralRepo.setReferralCodeActive(pool, id, active);
      if (!ok) throw new HttpError(404, "Referral code not found");
      res.json({ ok: true, active });
    },

    customerRequestRefund: async (req: AuthedRequest, res: Response) => {
      const body = refundRequestSchema.parse(req.body);
      const paymentId = BigInt(body.paymentId);
      const pay = await paymentRepo.findPaymentById(pool, paymentId);
      if (!pay) throw new HttpError(404, "Payment not found");
      if (String(pay.payer_user_id) !== String(req.userId!)) throw new HttpError(403, "Forbidden");
      if (String(pay.status) !== "captured") throw new HttpError(400, "Payment not refundable");
      const maxAmt = BigInt(String(pay.amount_minor));
      const reqAmt = body.amountMinor != null ? BigInt(body.amountMinor) : maxAmt;
      if (reqAmt <= 0n || reqAmt > maxAmt) throw new HttpError(400, "Invalid refund amount");
      const id = await marketplaceRepo.insertRefundRecord(pool, {
        paymentId,
        amountMinor: reqAmt,
        requestedByUserId: req.userId!,
        notes: body.notes ?? null,
      });
      res.status(201).json({ refundId: String(id) });
    },

    adminListPendingRefunds: async (_req: AuthedRequest, res: Response) => {
      const rows = await marketplaceRepo.listRefundsPending(pool);
      res.json({
        refunds: rows.map((r) => ({
          id: String(r.id),
          paymentId: String(r.payment_id),
          amountMinor: String(r.amount_minor),
          notes: r.notes != null ? String(r.notes) : null,
          createdAt: r.created_at,
          razorpayPaymentId: r.razorpay_payment_id != null ? String(r.razorpay_payment_id) : null,
          payerUserId: String(r.payer_user_id),
          serviceBookingId: r.service_booking_id != null ? String(r.service_booking_id) : null,
          bookingId: r.booking_id != null ? String(r.booking_id) : null,
          ticketOrderId: r.ticket_order_id != null ? String(r.ticket_order_id) : null,
        })),
      });
    },

    adminApproveRefund: async (req: AuthedRequest, res: Response) => {
      const refundId = pid(req.params.refundId);
      const row = await marketplaceRepo.findRefundById(pool, refundId);
      if (!row || String(row.status) !== "requested") throw new HttpError(404, "Refund not found");
      const rzPay = row.razorpay_payment_id != null ? String(row.razorpay_payment_id) : "";
      if (!rzPay) throw new HttpError(400, "Missing Razorpay payment id");
      const amountMinor = Number(row.refund_amount_minor);
      const result = await razorpay.createRefund(rzPay, amountMinor);
      const ok = await marketplaceRepo.markRefundProcessed(pool, refundId, result.refundId, req.userId!);
      if (!ok) throw new HttpError(400, "Could not update refund");
      await auditRepo.insertAuditLog(pool, {
        actorUserId: req.userId!,
        action: "REFUND_PROCESSED",
        entityType: "refund",
        entityId: String(refundId),
        metadata: { razorpayRefundId: result.refundId },
      });
      res.json({ ok: true, razorpayRefundId: result.refundId });
    },

    adminRejectRefund: async (req: AuthedRequest, res: Response) => {
      const refundId = pid(req.params.refundId);
      const ok = await marketplaceRepo.markRefundRejected(pool, refundId, req.userId!);
      if (!ok) throw new HttpError(404, "Refund not found");
      res.json({ ok: true });
    },
  };
}
