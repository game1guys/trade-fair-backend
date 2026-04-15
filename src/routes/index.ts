import type { Pool } from "mysql2/promise";
import { type Router } from "express";
import rateLimit from "express-rate-limit";
import { createAuthController } from "../controllers/authController.js";
import { createPhase1Controller } from "../controllers/phase1Controller.js";
import { createPhase2AdminController } from "../controllers/phase2AdminController.js";
import { createPhase2UserController } from "../controllers/phase2UserController.js";
import { createRazorpayWebhookHandler } from "../controllers/razorpayWebhookController.js";
import { requireAuth, type AuthedRequest } from "../middlewares/authMiddleware.js";
import { requireAnyRole, requirePermission, requireSubAdminScope } from "../middlewares/rbacMiddleware.js";

export function registerRoutes(router: Router, pool: Pool) {
  const auth = createAuthController(pool);
  const p1 = createPhase1Controller(pool);
  const p2a = createPhase2AdminController(pool);
  const p2u = createPhase2UserController(pool);
  const rzWebhook = createRazorpayWebhookHandler(pool);

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
  });

  router.get("/health", (_req, res) => {
    res.json({ ok: true, service: "tradefair-api" });
  });

  router.post("/payments/razorpay/webhook", (req, res, next) => {
    void rzWebhook(req as Parameters<typeof rzWebhook>[0], res).catch(next);
  });

  router.post("/auth/signup", authLimiter, (req, res, next) =>
    auth.signup(req as AuthedRequest, res).catch(next)
  );
  router.post("/auth/login", authLimiter, (req, res, next) =>
    auth.login(req as AuthedRequest, res).catch(next)
  );
  router.post("/auth/refresh", authLimiter, (req, res, next) =>
    auth.refresh(req as AuthedRequest, res).catch(next)
  );
  router.post("/auth/logout", (req, res, next) => auth.logout(req as AuthedRequest, res).catch(next));
  router.get("/auth/me", requireAuth, (req, res, next) => auth.me(req as AuthedRequest, res).catch(next));
  router.post("/auth/phone/request-otp", authLimiter, (req, res, next) =>
    auth.phoneRequestOtp(req as AuthedRequest, res).catch(next)
  );
  router.post("/auth/phone/verify-otp", authLimiter, (req, res, next) =>
    auth.phoneVerifyOtp(req as AuthedRequest, res).catch(next)
  );

  // --- Phase 1: public events (static segments before /events/:eventId) ---
  router.get("/events/categories", (req, res, next) =>
    p1.listPublicEventCategories(req as AuthedRequest, res).catch(next)
  );
  router.get("/events/:eventId/ticket-types", (req, res, next) =>
    p1.publicListTicketTypes(req as AuthedRequest, res).catch(next)
  );
  router.get("/events", (req, res, next) => p1.listPublicEvents(req as AuthedRequest, res).catch(next));
  router.get("/events/:eventId", (req, res, next) => p1.getPublicEvent(req as AuthedRequest, res).catch(next));

  // Organizer
  router.get(
    "/organizer/events",
    requireAuth,
    requireAnyRole(pool, "ORGANIZER"),
    (req, res, next) => p1.organizerListEvents(req as AuthedRequest, res).catch(next)
  );
  router.get(
    "/organizer/events/:eventId",
    requireAuth,
    requireAnyRole(pool, "ORGANIZER"),
    (req, res, next) => p1.organizerGetEvent(req as AuthedRequest, res).catch(next)
  );
  router.post(
    "/organizer/events",
    requireAuth,
    requireAnyRole(pool, "ORGANIZER"),
    (req, res, next) => p1.organizerCreateEvent(req as AuthedRequest, res).catch(next)
  );
  router.patch(
    "/organizer/events/:eventId",
    requireAuth,
    requireAnyRole(pool, "ORGANIZER"),
    (req, res, next) => p1.organizerUpdateEvent(req as AuthedRequest, res).catch(next)
  );
  router.post(
    "/organizer/events/:eventId/publish",
    requireAuth,
    requireAnyRole(pool, "ORGANIZER"),
    (req, res, next) => p1.organizerPublishEvent(req as AuthedRequest, res).catch(next)
  );
  router.delete(
    "/organizer/events/:eventId",
    requireAuth,
    requireAnyRole(pool, "ORGANIZER"),
    (req, res, next) => p1.organizerDeleteEvent(req as AuthedRequest, res).catch(next)
  );
  router.get(
    "/organizer/events/:eventId/stall-types",
    requireAuth,
    requireAnyRole(pool, "ORGANIZER"),
    (req, res, next) => p1.organizerListStallTypes(req as AuthedRequest, res).catch(next)
  );
  router.post(
    "/organizer/events/:eventId/stall-types",
    requireAuth,
    requireAnyRole(pool, "ORGANIZER"),
    (req, res, next) => p1.organizerCreateStallType(req as AuthedRequest, res).catch(next)
  );
  router.get(
    "/organizer/events/:eventId/stalls",
    requireAuth,
    requireAnyRole(pool, "ORGANIZER"),
    (req, res, next) => p1.organizerListStalls(req as AuthedRequest, res).catch(next)
  );
  router.post(
    "/organizer/events/:eventId/stalls",
    requireAuth,
    requireAnyRole(pool, "ORGANIZER"),
    (req, res, next) => p1.organizerCreateStall(req as AuthedRequest, res).catch(next)
  );
  router.post(
    "/organizer/events/:eventId/stalls/bulk",
    requireAuth,
    requireAnyRole(pool, "ORGANIZER"),
    (req, res, next) => p1.organizerCreateStallsBulk(req as AuthedRequest, res).catch(next)
  );
  router.get(
    "/organizer/events/:eventId/ticket-types",
    requireAuth,
    requireAnyRole(pool, "ORGANIZER"),
    (req, res, next) => p1.organizerListTicketTypes(req as AuthedRequest, res).catch(next)
  );
  router.post(
    "/organizer/events/:eventId/ticket-types",
    requireAuth,
    requireAnyRole(pool, "ORGANIZER"),
    (req, res, next) => p1.organizerCreateTicketType(req as AuthedRequest, res).catch(next)
  );
  router.post(
    "/organizer/events/:eventId/entry/scan",
    requireAuth,
    requireAnyRole(pool, "ORGANIZER"),
    (req, res, next) => p1.organizerScanEntry(req as AuthedRequest, res).catch(next)
  );
  router.get(
    "/organizer/events/:eventId/bookings",
    requireAuth,
    requireAnyRole(pool, "ORGANIZER"),
    (req, res, next) => p1.organizerListEventBookings(req as AuthedRequest, res).catch(next)
  );
  router.get(
    "/organizer/events/:eventId/tickets",
    requireAuth,
    requireAnyRole(pool, "ORGANIZER"),
    (req, res, next) => p1.organizerListEventTickets(req as AuthedRequest, res).catch(next)
  );
  router.get(
    "/organizer/events/:eventId/entry-scans",
    requireAuth,
    requireAnyRole(pool, "ORGANIZER"),
    (req, res, next) => p1.organizerListEventEntryScans(req as AuthedRequest, res).catch(next)
  );
  router.get(
    "/organizer/events/:eventId/entry/logs",
    requireAuth,
    requireAnyRole(pool, "ORGANIZER"),
    (req, res, next) => p1.organizerListEventEntryLogs(req as AuthedRequest, res).catch(next)
  );
  router.get(
    "/organizer/events/:eventId/media",
    requireAuth,
    requireAnyRole(pool, "ORGANIZER"),
    (req, res, next) => p1.organizerListEventMedia(req as AuthedRequest, res).catch(next)
  );
  router.post(
    "/organizer/events/:eventId/media",
    requireAuth,
    requireAnyRole(pool, "ORGANIZER"),
    (req, res, next) => p1.organizerAddEventMedia(req as AuthedRequest, res).catch(next)
  );
  router.delete(
    "/organizer/events/:eventId/media/:mediaId",
    requireAuth,
    requireAnyRole(pool, "ORGANIZER"),
    (req, res, next) => p1.organizerDeleteEventMedia(req as AuthedRequest, res).catch(next)
  );
  router.get(
    "/organizer/events/:eventId/announcements",
    requireAuth,
    requireAnyRole(pool, "ORGANIZER"),
    (req, res, next) => p1.organizerListAnnouncements(req as AuthedRequest, res).catch(next)
  );
  router.post(
    "/organizer/events/:eventId/announcements",
    requireAuth,
    requireAnyRole(pool, "ORGANIZER"),
    (req, res, next) => p1.organizerCreateAnnouncement(req as AuthedRequest, res).catch(next)
  );
  router.patch(
    "/organizer/events/:eventId/stalls/:stallId",
    requireAuth,
    requireAnyRole(pool, "ORGANIZER"),
    (req, res, next) => p1.organizerPatchStall(req as AuthedRequest, res).catch(next)
  );
  router.patch(
    "/organizer/stalls/:stallId/status",
    requireAuth,
    requireAnyRole(pool, "ORGANIZER"),
    // map to /organizer/events/:eventId/stalls/:stallId by injecting params
    (req, res, next) => {
      const eventId = (req as unknown as { body?: { eventId?: string } }).body?.eventId;
      (req as unknown as { params: Record<string, string> }).params = {
        eventId: String(eventId ?? ""),
        stallId: (req as unknown as { params: Record<string, string> }).params.stallId,
      };
      p1.organizerPatchStall(req as AuthedRequest, res).catch(next);
    }
  );

  // Exhibitor
  router.get(
    "/exhibitor/events",
    requireAuth,
    requireAnyRole(pool, "EXHIBITOR"),
    (req, res, next) => p1.exhibitorListEvents(req as AuthedRequest, res).catch(next)
  );
  router.get(
    "/exhibitor/events/:eventId/stalls",
    requireAuth,
    requireAnyRole(pool, "EXHIBITOR"),
    (req, res, next) => p1.exhibitorListEventStalls(req as AuthedRequest, res).catch(next)
  );
  router.post(
    "/exhibitor/stalls/:stallId/hold",
    requireAuth,
    requireAnyRole(pool, "EXHIBITOR"),
    (req, res, next) => p1.exhibitorHoldStall(req as AuthedRequest, res).catch(next)
  );
  router.get(
    "/exhibitor/events/:eventId/catalog",
    requireAuth,
    requireAnyRole(pool, "EXHIBITOR"),
    (req, res, next) => p1.exhibitorEventCatalog(req as AuthedRequest, res).catch(next)
  );
  router.get(
    "/exhibitor/profile",
    requireAuth,
    requireAnyRole(pool, "EXHIBITOR"),
    (req, res, next) => p1.exhibitorGetProfile(req as AuthedRequest, res).catch(next)
  );
  router.patch(
    "/exhibitor/profile",
    requireAuth,
    requireAnyRole(pool, "EXHIBITOR"),
    (req, res, next) => p1.exhibitorPatchProfile(req as AuthedRequest, res).catch(next)
  );
  router.get(
    "/exhibitor/payments",
    requireAuth,
    requireAnyRole(pool, "EXHIBITOR"),
    (req, res, next) => p1.exhibitorListPayments(req as AuthedRequest, res).catch(next)
  );
  router.get(
    "/exhibitor/bookings",
    requireAuth,
    requireAnyRole(pool, "EXHIBITOR"),
    (req, res, next) => p1.exhibitorListBookings(req as AuthedRequest, res).catch(next)
  );
  router.post(
    "/exhibitor/bookings/:bookingId/refund-request",
    requireAuth,
    requireAnyRole(pool, "EXHIBITOR"),
    (req, res, next) => p1.exhibitorRequestBookingRefund(req as AuthedRequest, res).catch(next)
  );
  router.post(
    "/exhibitor/events/:eventId/bookings",
    requireAuth,
    requireAnyRole(pool, "EXHIBITOR"),
    (req, res, next) => p1.exhibitorCreateBooking(req as AuthedRequest, res).catch(next)
  );
  router.post(
    "/exhibitor/bookings/:bookingId/pay/verify",
    requireAuth,
    requireAnyRole(pool, "EXHIBITOR"),
    (req, res, next) => p1.exhibitorVerifyBooking(req as AuthedRequest, res).catch(next)
  );

  // Visitor
  router.post(
    "/visitor/events/:eventId/ticket-orders",
    requireAuth,
    requireAnyRole(pool, "VISITOR"),
    (req, res, next) => p1.visitorCreateTicketOrder(req as AuthedRequest, res).catch(next)
  );
  router.post(
    "/visitor/ticket-orders/:orderId/pay/verify",
    requireAuth,
    requireAnyRole(pool, "VISITOR"),
    (req, res, next) => p1.visitorVerifyTicketOrder(req as AuthedRequest, res).catch(next)
  );
  router.get(
    "/visitor/tickets",
    requireAuth,
    requireAnyRole(pool, "VISITOR"),
    (req, res, next) => p1.visitorListTickets(req as AuthedRequest, res).catch(next)
  );
  router.get(
    "/visitor/receipts",
    requireAuth,
    requireAnyRole(pool, "VISITOR"),
    (req, res, next) => p1.visitorListReceipts(req as AuthedRequest, res).catch(next)
  );

  // --- Phase 2: user KYC + Support ---
  router.post("/kyc/documents", requireAuth, (req, res, next) =>
    p2u.submitKyc(req as AuthedRequest, res).catch(next)
  );
  router.get("/kyc/me", requireAuth, (req, res, next) => p2u.listMyKyc(req as AuthedRequest, res).catch(next));

  router.post("/support/tickets", requireAuth, (req, res, next) =>
    p2u.createSupportTicket(req as AuthedRequest, res).catch(next)
  );
  router.get("/support/tickets/me", requireAuth, (req, res, next) =>
    p2u.listMySupportTickets(req as AuthedRequest, res).catch(next)
  );

  // --- Phase 2: admin ---
  router.get(
    "/admin/users",
    requireAuth,
    requirePermission(pool, "admin.users.read"),
    (req, res, next) => p2a.adminListUsers(req as AuthedRequest, res).catch(next)
  );
  router.patch(
    "/admin/users/:id/status",
    requireAuth,
    requirePermission(pool, "admin.users.write"),
    (req, res, next) => p2a.adminPatchUserStatus(req as AuthedRequest, res).catch(next)
  );
  router.post(
    "/admin/users/:id/roles",
    requireAuth,
    requirePermission(pool, "admin.users.write"),
    (req, res, next) => p2a.adminAssignRole(req as AuthedRequest, res).catch(next)
  );

  router.get(
    "/admin/kyc",
    requireAuth,
    requirePermission(pool, "admin.kyc.read"),
    requireSubAdminScope(pool, "kyc"),
    (req, res, next) => p2a.adminListKyc(req as AuthedRequest, res).catch(next)
  );
  router.patch(
    "/admin/kyc/:docId/review",
    requireAuth,
    requirePermission(pool, "admin.kyc.write"),
    requireSubAdminScope(pool, "kyc"),
    (req, res, next) => p2a.adminReviewKyc(req as AuthedRequest, res).catch(next)
  );

  router.post(
    "/admin/sub-admins",
    requireAuth,
    requirePermission(pool, "admin.sub_admins.write"),
    (req, res, next) => p2a.adminCreateSubAdmin(req as AuthedRequest, res).catch(next)
  );
  router.put(
    "/admin/sub-admins/:id/scopes",
    requireAuth,
    requirePermission(pool, "admin.scopes.write"),
    (req, res, next) => p2a.adminPutSubAdminScopes(req as AuthedRequest, res).catch(next)
  );

  router.get(
    "/admin/support/tickets",
    requireAuth,
    requirePermission(pool, "admin.support.read"),
    requireSubAdminScope(pool, "support"),
    (req, res, next) => p2a.adminListSupport(req as AuthedRequest, res).catch(next)
  );
  router.patch(
    "/admin/support/tickets/:id",
    requireAuth,
    requirePermission(pool, "admin.support.write"),
    requireSubAdminScope(pool, "support"),
    (req, res, next) => p2a.adminPatchSupport(req as AuthedRequest, res).catch(next)
  );

  router.get(
    "/admin/settings/:key",
    requireAuth,
    requirePermission(pool, "admin.settings.read"),
    requireSubAdminScope(pool, "settings"),
    (req, res, next) => p2a.adminGetSetting(req as AuthedRequest, res).catch(next)
  );
  router.put(
    "/admin/settings/:key",
    requireAuth,
    requirePermission(pool, "admin.settings.write"),
    requireSubAdminScope(pool, "settings"),
    (req, res, next) => p2a.adminPutSetting(req as AuthedRequest, res).catch(next)
  );

  // Payments (plan-compat)
  router.post("/payments/razorpay/orders", (req, res, next) =>
    p1.razorpayCreateOrder(req as AuthedRequest, res).catch(next)
  );
  router.post("/payments/razorpay/verify", (req, res, next) =>
    p1.razorpayVerifySignature(req as AuthedRequest, res).catch(next)
  );
  router.post("/webhooks/razorpay", (req, res, next) => {
    void rzWebhook(req as Parameters<typeof rzWebhook>[0], res).catch(next);
  });
}
