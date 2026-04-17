import type { Pool } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import type { Response } from "express";
import * as auditRepo from "../repositories/auditRepository.js";
import * as marketplaceRepo from "../repositories/marketplaceRepository.js";
import * as paymentRepo from "../repositories/paymentRepository.js";
import * as settingsRepo from "../repositories/settingsRepository.js";
import * as userRepo from "../repositories/userRepository.js";
import * as moderationRepo from "../repositories/moderationRepository.js";
import * as razorpay from "../services/razorpayService.js";
import { insertServiceBookingPaymentRecord } from "../services/paymentFinalizeService.js";
import { HttpError } from "../utils/httpError.js";
import type { AuthedRequest } from "../middlewares/authMiddleware.js";
import { verifyRazorpaySchema } from "../validators/phase1Schemas.js";
import {
  adminSubscribeUserSchema,
  commissionRuleSchema,
  providerBookingCreateSchema,
  providerProfileSchema,
  refundRequestSchema,
  revenueModelSchema,
  serviceCreateSchema,
  servicePatchSchema,
  serviceRequestCreateSchema,
  serviceRequestPatchSchema,
  serviceReviewCreateSchema,
  subscriptionPlanSchema,
} from "../validators/phase3Schemas.js";

function pid(v: string | string[] | undefined): bigint {
  const s = Array.isArray(v) ? v[0] : v;
  if (!s) throw new HttpError(400, "Missing id");
  return BigInt(s);
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

async function loadRevenueMode(pool: Pool): Promise<"commission" | "subscription"> {
  const row = await settingsRepo.getSetting(pool, "platform.revenue_model");
  const v = row?.value as { mode?: string } | undefined;
  return v?.mode === "subscription" ? "subscription" : "commission";
}

async function effectiveCommissionBps(
  pool: Pool,
  payerUserId: bigint,
  service: { event_id: bigint | null; category_id: number }
): Promise<{ commissionBps: number }> {
  const mode = await loadRevenueMode(pool);
  if (mode === "subscription") {
    const sub = await marketplaceRepo.findActiveSubscription(pool, payerUserId);
    if (sub) return { commissionBps: 0 };
  }
  const bps = await marketplaceRepo.resolveCommissionBps(pool, {
    eventId: service.event_id,
    categoryId: service.category_id,
  });
  return { commissionBps: bps };
}

export function createPhase3Controller(pool: Pool) {
  return {
    listServiceCategories: async (_req: AuthedRequest, res: Response) => {
      const categories = await marketplaceRepo.listServiceCategories(pool);
      res.json({ categories });
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
          categoryName: String(r.category_name),
          companyName: r.company_name != null ? String(r.company_name) : null,
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
          categoryName: String(row.category_name),
          companyName: row.company_name != null ? String(row.company_name) : null,
          tagline: row.tagline != null ? String(row.tagline) : null,
          city: row.city != null ? String(row.city) : null,
          state: row.state != null ? String(row.state) : null,
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
          status: String(r.status),
          categoryName: String(r.category_name),
          updatedAt: r.updated_at,
        })),
      });
    },

    providerCreateService: async (req: AuthedRequest, res: Response) => {
      const body = serviceCreateSchema.parse(req.body);
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
      const ok = await marketplaceRepo.updateService(pool, serviceId, req.userId!, {
        categoryId: body.categoryId,
        eventId: body.eventId !== undefined ? (body.eventId ? BigInt(body.eventId) : null) : undefined,
        title: body.title,
        description: body.description,
        priceMinor: body.priceMinor != null ? BigInt(body.priceMinor) : undefined,
        portfolioUrls: body.portfolioUrls,
        status: body.status,
      });
      if (!ok) throw new HttpError(404, "Service not found");
      if (body.status === "published") {
        await moderationRepo.ensureOpenFlag(pool, { entityType: "service", entityId: String(serviceId) });
      }
      res.json({ ok: true });
    },

    providerListRequests: async (req: AuthedRequest, res: Response) => {
      const rows = await marketplaceRepo.listRequestsForProvider(pool, req.userId!);
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
        })),
      });
    },

    providerPatchRequest: async (req: AuthedRequest, res: Response) => {
      const requestId = pid(req.params.requestId);
      const body = serviceRequestPatchSchema.parse(req.body);
      const ok = await marketplaceRepo.patchServiceRequest(pool, requestId, req.userId!, body);
      if (!ok) throw new HttpError(404, "Request not found");
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
      const rows = await marketplaceRepo.listBookingsForProvider(pool, req.userId!);
      res.json({
        bookings: rows.map((b) => ({
          id: String(b.id),
          serviceId: String(b.service_id),
          customerUserId: String(b.customer_user_id),
          amountMinor: String(b.amount_minor),
          currency: String(b.currency),
          status: String(b.status),
          scheduledAt: b.scheduled_at,
          serviceTitle: String(b.service_title),
          customerEmail: String(b.customer_email),
          customerName: String(b.customer_name),
        })),
      });
    },

    providerPatchBooking: async (req: AuthedRequest, res: Response) => {
      const bookingId = pid(req.params.bookingId);
      const status = String(req.body?.status ?? "");
      if (!["confirmed", "rejected", "completed", "cancelled"].includes(status)) {
        throw new HttpError(400, "Invalid status");
      }
      const ok = await marketplaceRepo.updateServiceBookingStatus(
        pool,
        bookingId,
        req.userId!,
        status as "confirmed" | "rejected" | "completed" | "cancelled"
      );
      if (!ok) throw new HttpError(404, "Booking not found");
      res.json({ ok: true });
    },

    customerCreateRequest: async (req: AuthedRequest, res: Response) => {
      const serviceId = pid(req.params.serviceId);
      const body = serviceRequestCreateSchema.parse(req.body);
      const svc = await marketplaceRepo.findServiceById(pool, serviceId);
      if (!svc || svc.status !== "published") throw new HttpError(404, "Service not found");
      if (svc.provider_user_id === req.userId!) throw new HttpError(400, "Cannot enquire on own listing");
      const id = await marketplaceRepo.insertServiceRequest(pool, {
        serviceId,
        fromUserId: req.userId!,
        message: body.message,
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
        })),
      });
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
      const { commissionBps } = await effectiveCommissionBps(pool, req.userId!, {
        event_id: svc.event_id,
        category_id: Number(svc.category_id),
      });
      const gross = BigInt(String(b.amount_minor));
      const platformFee = (gross * BigInt(commissionBps)) / 10000n;
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
      const svc = await marketplaceRepo.findServiceById(pool, BigInt(String(b.service_id)));
      if (!svc) throw new HttpError(404, "Service not found");
      const { commissionBps } = await effectiveCommissionBps(pool, req.userId!, {
        event_id: svc.event_id,
        category_id: Number(svc.category_id),
      });
      const gross = BigInt(String(b.amount_minor));
      const platformFee = (gross * BigInt(commissionBps)) / 10000n;
      const confirmed = await marketplaceRepo.confirmServiceBookingPayment(pool, bookingId);
      if (!confirmed) throw new HttpError(400, "Could not confirm booking");
      await insertServiceBookingPaymentRecord(pool, {
        payerUserId: req.userId!,
        amountMinor: gross,
        razorpayOrderId: body.razorpayOrderId,
        razorpayPaymentId: body.razorpayPaymentId,
        serviceBookingId: bookingId,
        metadata: {
          commissionBps,
          platformFeeMinor: String(platformFee),
          revenueMode: await loadRevenueMode(pool),
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

    adminGetRevenueModel: async (_req: AuthedRequest, res: Response) => {
      const row = await settingsRepo.getSetting(pool, "platform.revenue_model");
      res.json({ revenueModel: row?.value ?? { mode: "commission" } });
    },

    adminPutRevenueModel: async (req: AuthedRequest, res: Response) => {
      const body = revenueModelSchema.parse(req.body);
      await settingsRepo.upsertSetting(pool, "platform.revenue_model", body, req.userId!);
      res.json({ ok: true });
    },

    adminListCommissionRules: async (_req: AuthedRequest, res: Response) => {
      const rows = await marketplaceRepo.listCommissionRules(pool);
      res.json({
        rules: rows.map((r) => ({
          id: Number(r.id),
          scopeType: String(r.scope_type),
          eventId: r.event_id != null ? String(r.event_id) : null,
          serviceCategoryId: r.service_category_id != null ? Number(r.service_category_id) : null,
          commissionBps: Number(r.commission_bps),
          active: Boolean(r.active),
        })),
      });
    },

    adminPutCommissionRule: async (req: AuthedRequest, res: Response) => {
      const body = commissionRuleSchema.parse(req.body);
      const id = await marketplaceRepo.upsertCommissionRule(pool, {
        id: body.id,
        scopeType: body.scopeType,
        eventId: body.eventId ? BigInt(body.eventId) : null,
        serviceCategoryId: body.serviceCategoryId ?? null,
        commissionBps: body.commissionBps,
        active: body.active,
      });
      res.json({ id: String(id) });
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
      });
      res.json({ id });
    },

    adminSubscribeUser: async (req: AuthedRequest, res: Response) => {
      const body = adminSubscribeUserSchema.parse(req.body);
      const userId = BigInt(body.userId);
      const [plans] = await pool.query<RowDataPacket[]>(
        "SELECT id, duration_days FROM subscription_plans WHERE id = ? AND active = 1",
        [body.planId]
      );
      if (!plans.length) throw new HttpError(404, "Plan not found");
      const days = Number(plans[0].duration_days);
      const starts = new Date();
      const ends = new Date(starts.getTime() + days * 86400000);
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

    customerRequestRefund: async (req: AuthedRequest, res: Response) => {
      const body = refundRequestSchema.parse(req.body);
      const paymentId = BigInt(body.paymentId);
      const pay = await paymentRepo.findPaymentById(pool, paymentId);
      if (!pay) throw new HttpError(404, "Payment not found");
      if (String(pay.payer_user_id) !== String(req.userId!)) throw new HttpError(403, "Forbidden");
      if (!pay.service_booking_id) throw new HttpError(400, "Refund only supported for service payments in Phase 3");
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
