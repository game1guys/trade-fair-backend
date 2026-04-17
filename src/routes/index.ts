import type { Pool } from "mysql2/promise";
import { type Router } from "express";
import rateLimit from "express-rate-limit";
import { createAuthController } from "../controllers/authController.js";
import { createPhase1Controller } from "../controllers/phase1Controller.js";
import { createPhase2AdminController } from "../controllers/phase2AdminController.js";
import { createPhase2UserController } from "../controllers/phase2UserController.js";
import { createPhase3Controller } from "../controllers/phase3Controller.js";
import { createPhase4AdminController } from "../controllers/phase4AdminController.js";
import { createRazorpayWebhookHandler } from "../controllers/razorpayWebhookController.js";
import { requireAuth, type AuthedRequest } from "../middlewares/authMiddleware.js";
import { ensureRole, requireAnyRole, requirePermission, requireSubAdminScope } from "../middlewares/rbacMiddleware.js";

export function registerRoutes(router: Router, pool: Pool) {
  const auth = createAuthController(pool);
  const p1 = createPhase1Controller(pool);
  const p2a = createPhase2AdminController(pool);
  const p2u = createPhase2UserController(pool);
  const p3 = createPhase3Controller(pool);
  const p4a = createPhase4AdminController(pool);
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
    ensureRole(pool, "ORGANIZER"),
    (req, res, next) => p1.organizerListEvents(req as AuthedRequest, res).catch(next)
  );
  router.get(
    "/organizer/events/:eventId",
    requireAuth,
    ensureRole(pool, "ORGANIZER"),
    (req, res, next) => p1.organizerGetEvent(req as AuthedRequest, res).catch(next)
  );
  router.post(
    "/organizer/events",
    requireAuth,
    ensureRole(pool, "ORGANIZER"),
    (req, res, next) => p1.organizerCreateEvent(req as AuthedRequest, res).catch(next)
  );
  router.patch(
    "/organizer/events/:eventId",
    requireAuth,
    ensureRole(pool, "ORGANIZER"),
    (req, res, next) => p1.organizerUpdateEvent(req as AuthedRequest, res).catch(next)
  );
  router.post(
    "/organizer/events/:eventId/publish",
    requireAuth,
    ensureRole(pool, "ORGANIZER"),
    (req, res, next) => p1.organizerPublishEvent(req as AuthedRequest, res).catch(next)
  );
  router.delete(
    "/organizer/events/:eventId",
    requireAuth,
    ensureRole(pool, "ORGANIZER"),
    (req, res, next) => p1.organizerDeleteEvent(req as AuthedRequest, res).catch(next)
  );
  router.get(
    "/organizer/events/:eventId/stall-types",
    requireAuth,
    ensureRole(pool, "ORGANIZER"),
    (req, res, next) => p1.organizerListStallTypes(req as AuthedRequest, res).catch(next)
  );
  router.post(
    "/organizer/events/:eventId/stall-types",
    requireAuth,
    ensureRole(pool, "ORGANIZER"),
    (req, res, next) => p1.organizerCreateStallType(req as AuthedRequest, res).catch(next)
  );
  router.get(
    "/organizer/events/:eventId/stalls",
    requireAuth,
    ensureRole(pool, "ORGANIZER"),
    (req, res, next) => p1.organizerListStalls(req as AuthedRequest, res).catch(next)
  );
  router.post(
    "/organizer/events/:eventId/stalls",
    requireAuth,
    ensureRole(pool, "ORGANIZER"),
    (req, res, next) => p1.organizerCreateStall(req as AuthedRequest, res).catch(next)
  );
  router.post(
    "/organizer/events/:eventId/stalls/bulk",
    requireAuth,
    ensureRole(pool, "ORGANIZER"),
    (req, res, next) => p1.organizerCreateStallsBulk(req as AuthedRequest, res).catch(next)
  );
  router.get(
    "/organizer/events/:eventId/ticket-types",
    requireAuth,
    ensureRole(pool, "ORGANIZER"),
    (req, res, next) => p1.organizerListTicketTypes(req as AuthedRequest, res).catch(next)
  );
  router.post(
    "/organizer/events/:eventId/ticket-types",
    requireAuth,
    ensureRole(pool, "ORGANIZER"),
    (req, res, next) => p1.organizerCreateTicketType(req as AuthedRequest, res).catch(next)
  );
  router.post(
    "/organizer/events/:eventId/entry/scan",
    requireAuth,
    ensureRole(pool, "ORGANIZER"),
    (req, res, next) => p1.organizerScanEntry(req as AuthedRequest, res).catch(next)
  );
  router.get(
    "/organizer/events/:eventId/bookings",
    requireAuth,
    ensureRole(pool, "ORGANIZER"),
    (req, res, next) => p1.organizerListEventBookings(req as AuthedRequest, res).catch(next)
  );
  router.get(
    "/organizer/events/:eventId/tickets",
    requireAuth,
    ensureRole(pool, "ORGANIZER"),
    (req, res, next) => p1.organizerListEventTickets(req as AuthedRequest, res).catch(next)
  );
  router.get(
    "/organizer/events/:eventId/entry-scans",
    requireAuth,
    ensureRole(pool, "ORGANIZER"),
    (req, res, next) => p1.organizerListEventEntryScans(req as AuthedRequest, res).catch(next)
  );
  router.get(
    "/organizer/events/:eventId/entry/logs",
    requireAuth,
    ensureRole(pool, "ORGANIZER"),
    (req, res, next) => p1.organizerListEventEntryLogs(req as AuthedRequest, res).catch(next)
  );
  router.get(
    "/organizer/events/:eventId/media",
    requireAuth,
    ensureRole(pool, "ORGANIZER"),
    (req, res, next) => p1.organizerListEventMedia(req as AuthedRequest, res).catch(next)
  );
  router.post(
    "/organizer/events/:eventId/media",
    requireAuth,
    ensureRole(pool, "ORGANIZER"),
    (req, res, next) => p1.organizerAddEventMedia(req as AuthedRequest, res).catch(next)
  );
  router.delete(
    "/organizer/events/:eventId/media/:mediaId",
    requireAuth,
    ensureRole(pool, "ORGANIZER"),
    (req, res, next) => p1.organizerDeleteEventMedia(req as AuthedRequest, res).catch(next)
  );
  router.get(
    "/organizer/events/:eventId/announcements",
    requireAuth,
    ensureRole(pool, "ORGANIZER"),
    (req, res, next) => p1.organizerListAnnouncements(req as AuthedRequest, res).catch(next)
  );
  router.post(
    "/organizer/events/:eventId/announcements",
    requireAuth,
    ensureRole(pool, "ORGANIZER"),
    (req, res, next) => p1.organizerCreateAnnouncement(req as AuthedRequest, res).catch(next)
  );
  router.patch(
    "/organizer/events/:eventId/stalls/:stallId",
    requireAuth,
    ensureRole(pool, "ORGANIZER"),
    (req, res, next) => p1.organizerPatchStall(req as AuthedRequest, res).catch(next)
  );
  router.patch(
    "/organizer/stalls/:stallId/status",
    requireAuth,
    ensureRole(pool, "ORGANIZER"),
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
    (req, res, next) => p1.exhibitorGetProfile(req as AuthedRequest, res).catch(next)
  );
  router.patch(
    "/exhibitor/profile",
    requireAuth,
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
  router.post(
    "/visitor/tickets/demo",
    requireAuth,
    requireAnyRole(pool, "VISITOR"),
    (req, res, next) => p1.visitorCreateDemoTicket(req as AuthedRequest, res).catch(next)
  );
  router.get(
    "/visitor/receipts",
    requireAuth,
    requireAnyRole(pool, "VISITOR"),
    (req, res, next) => p1.visitorListReceipts(req as AuthedRequest, res).catch(next)
  );

  // --- Phase 3: marketplace (public catalog) ---
  router.get("/service-categories", (req, res, next) =>
    p3.listServiceCategories(req as AuthedRequest, res).catch(next)
  );
  router.get("/services", (req, res, next) => p3.listPublishedServices(req as AuthedRequest, res).catch(next));
  router.get("/services/:serviceId", (req, res, next) => p3.getPublishedService(req as AuthedRequest, res).catch(next));

  const marketplaceCustomer = requireAnyRole(pool, "EXHIBITOR", "VISITOR", "ORGANIZER");

  router.post(
    "/marketplace/services/:serviceId/requests",
    requireAuth,
    marketplaceCustomer,
    (req, res, next) => p3.customerCreateRequest(req as AuthedRequest, res).catch(next)
  );
  router.get(
    "/marketplace/my-requests",
    requireAuth,
    marketplaceCustomer,
    (req, res, next) => p3.customerListRequests(req as AuthedRequest, res).catch(next)
  );
  router.get(
    "/marketplace/my-bookings",
    requireAuth,
    marketplaceCustomer,
    (req, res, next) => p3.customerListBookings(req as AuthedRequest, res).catch(next)
  );
  router.post(
    "/marketplace/service-bookings/:bookingId/pay-order",
    requireAuth,
    marketplaceCustomer,
    (req, res, next) => p3.customerCreatePayOrder(req as AuthedRequest, res).catch(next)
  );
  router.post(
    "/marketplace/service-bookings/:bookingId/verify-pay",
    requireAuth,
    marketplaceCustomer,
    (req, res, next) => p3.customerVerifyServiceBookingPay(req as AuthedRequest, res).catch(next)
  );
  router.post(
    "/marketplace/service-bookings/:bookingId/review",
    requireAuth,
    marketplaceCustomer,
    (req, res, next) => p3.customerCreateReview(req as AuthedRequest, res).catch(next)
  );
  router.post(
    "/marketplace/refund-requests",
    requireAuth,
    marketplaceCustomer,
    (req, res, next) => p3.customerRequestRefund(req as AuthedRequest, res).catch(next)
  );

  router.get(
    "/provider/profile",
    requireAuth,
    (req, res, next) => p3.providerGetProfile(req as AuthedRequest, res).catch(next)
  );
  router.put(
    "/provider/profile",
    requireAuth,
    (req, res, next) => p3.providerPutProfile(req as AuthedRequest, res).catch(next)
  );
  router.get(
    "/provider/services",
    requireAuth,
    requireAnyRole(pool, "SERVICE_PROVIDER"),
    (req, res, next) => p3.providerListServices(req as AuthedRequest, res).catch(next)
  );
  router.post(
    "/provider/services",
    requireAuth,
    requireAnyRole(pool, "SERVICE_PROVIDER"),
    (req, res, next) => p3.providerCreateService(req as AuthedRequest, res).catch(next)
  );
  router.patch(
    "/provider/services/:serviceId",
    requireAuth,
    requireAnyRole(pool, "SERVICE_PROVIDER"),
    (req, res, next) => p3.providerPatchService(req as AuthedRequest, res).catch(next)
  );
  router.get(
    "/provider/service-requests",
    requireAuth,
    requireAnyRole(pool, "SERVICE_PROVIDER"),
    (req, res, next) => p3.providerListRequests(req as AuthedRequest, res).catch(next)
  );
  router.patch(
    "/provider/service-requests/:requestId",
    requireAuth,
    requireAnyRole(pool, "SERVICE_PROVIDER"),
    (req, res, next) => p3.providerPatchRequest(req as AuthedRequest, res).catch(next)
  );
  router.post(
    "/provider/service-bookings",
    requireAuth,
    requireAnyRole(pool, "SERVICE_PROVIDER"),
    (req, res, next) => p3.providerCreateBooking(req as AuthedRequest, res).catch(next)
  );
  router.get(
    "/provider/service-bookings",
    requireAuth,
    requireAnyRole(pool, "SERVICE_PROVIDER"),
    (req, res, next) => p3.providerListBookings(req as AuthedRequest, res).catch(next)
  );
  router.patch(
    "/provider/service-bookings/:bookingId",
    requireAuth,
    requireAnyRole(pool, "SERVICE_PROVIDER"),
    (req, res, next) => p3.providerPatchBooking(req as AuthedRequest, res).catch(next)
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
  router.post("/disputes", requireAuth, (req, res, next) => p2u.createDispute(req as AuthedRequest, res).catch(next));
  router.get("/notifications/me", requireAuth, (req, res, next) =>
    p2u.listMyNotifications(req as AuthedRequest, res).catch(next)
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

  router.get(
    "/admin/notification-templates",
    requireAuth,
    requirePermission(pool, "admin.notifications.write"),
    requireSubAdminScope(pool, "notifications"),
    (req, res, next) => p2a.adminListNotificationTemplates(req as AuthedRequest, res).catch(next)
  );
  router.put(
    "/admin/notification-templates",
    requireAuth,
    requirePermission(pool, "admin.notifications.write"),
    requireSubAdminScope(pool, "notifications"),
    (req, res, next) => p2a.adminUpsertNotificationTemplate(req as AuthedRequest, res).catch(next)
  );
  router.post(
    "/admin/notifications/send",
    requireAuth,
    requirePermission(pool, "admin.notifications.write"),
    requireSubAdminScope(pool, "notifications"),
    (req, res, next) => p2a.adminSendNotification(req as AuthedRequest, res).catch(next)
  );
  router.get(
    "/admin/notifications",
    requireAuth,
    requirePermission(pool, "admin.notifications.write"),
    requireSubAdminScope(pool, "notifications"),
    (req, res, next) => p2a.adminListNotifications(req as AuthedRequest, res).catch(next)
  );

  router.get(
    "/admin/disputes",
    requireAuth,
    requirePermission(pool, "admin.transactions.read"),
    requireSubAdminScope(pool, "support"),
    (req, res, next) => p2a.adminListDisputes(req as AuthedRequest, res).catch(next)
  );
  router.patch(
    "/admin/disputes/:id",
    requireAuth,
    requirePermission(pool, "admin.transactions.read"),
    requireSubAdminScope(pool, "support"),
    (req, res, next) => p2a.adminPatchDispute(req as AuthedRequest, res).catch(next)
  );

  // --- Phase 3: admin monetization & refunds ---
  router.get(
    "/admin/monetization/revenue-model",
    requireAuth,
    requirePermission(pool, "admin.monetization.read"),
    (req, res, next) => p3.adminGetRevenueModel(req as AuthedRequest, res).catch(next)
  );
  router.put(
    "/admin/monetization/revenue-model",
    requireAuth,
    requirePermission(pool, "admin.monetization.write"),
    (req, res, next) => p3.adminPutRevenueModel(req as AuthedRequest, res).catch(next)
  );
  router.get(
    "/admin/monetization/commission-rules",
    requireAuth,
    requirePermission(pool, "admin.monetization.read"),
    (req, res, next) => p3.adminListCommissionRules(req as AuthedRequest, res).catch(next)
  );
  router.put(
    "/admin/monetization/commission-rules",
    requireAuth,
    requirePermission(pool, "admin.monetization.write"),
    (req, res, next) => p3.adminPutCommissionRule(req as AuthedRequest, res).catch(next)
  );
  router.get(
    "/admin/monetization/subscription-plans",
    requireAuth,
    requirePermission(pool, "admin.monetization.read"),
    (req, res, next) => p3.adminListSubscriptionPlans(req as AuthedRequest, res).catch(next)
  );
  router.put(
    "/admin/monetization/subscription-plans",
    requireAuth,
    requirePermission(pool, "admin.monetization.write"),
    (req, res, next) => p3.adminPutSubscriptionPlan(req as AuthedRequest, res).catch(next)
  );
  router.post(
    "/admin/monetization/subscribe-user",
    requireAuth,
    requirePermission(pool, "admin.monetization.write"),
    (req, res, next) => p3.adminSubscribeUser(req as AuthedRequest, res).catch(next)
  );
  router.get(
    "/admin/refunds/pending",
    requireAuth,
    requirePermission(pool, "admin.monetization.read"),
    (req, res, next) => p3.adminListPendingRefunds(req as AuthedRequest, res).catch(next)
  );
  router.post(
    "/admin/refunds/:refundId/approve",
    requireAuth,
    requirePermission(pool, "admin.monetization.write"),
    (req, res, next) => p3.adminApproveRefund(req as AuthedRequest, res).catch(next)
  );
  router.post(
    "/admin/refunds/:refundId/reject",
    requireAuth,
    requirePermission(pool, "admin.monetization.write"),
    (req, res, next) => p3.adminRejectRefund(req as AuthedRequest, res).catch(next)
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

  // --- Phase 4: analytics, reports, transactions, moderation, featured ---
  router.get(
    "/admin/analytics/summary",
    requireAuth,
    requirePermission(pool, "admin.analytics.read"),
    (req, res, next) => p4a.analyticsSummary(req as AuthedRequest, res).catch(next)
  );
  router.get(
    "/admin/analytics/users-growth",
    requireAuth,
    requirePermission(pool, "admin.analytics.read"),
    (req, res, next) => p4a.analyticsUserGrowth(req as AuthedRequest, res).catch(next)
  );
  router.get(
    "/admin/transactions/ledger",
    requireAuth,
    requirePermission(pool, "admin.transactions.read"),
    (req, res, next) => p4a.transactionsLedger(req as AuthedRequest, res).catch(next)
  );
  // Plan-compat alias
  router.get(
    "/admin/transactions",
    requireAuth,
    requirePermission(pool, "admin.transactions.read"),
    (req, res, next) => p4a.transactionsLedger(req as AuthedRequest, res).catch(next)
  );
  router.get(
    "/admin/reports/ledger.csv",
    requireAuth,
    requirePermission(pool, "admin.reports.export"),
    (req, res, next) => p4a.exportLedgerCsv(req as AuthedRequest, res).catch(next)
  );

  router.get(
    "/admin/moderation/flags",
    requireAuth,
    requirePermission(pool, "admin.moderation.read"),
    requireSubAdminScope(pool, "moderation"),
    (req, res, next) => p4a.moderationListFlags(req as AuthedRequest, res).catch(next)
  );
  router.patch(
    "/admin/moderation/flags/:flagId",
    requireAuth,
    requirePermission(pool, "admin.moderation.write"),
    requireSubAdminScope(pool, "moderation"),
    (req, res, next) => p4a.moderationPatchFlag(req as AuthedRequest, res).catch(next)
  );

  router.get(
    "/admin/featured",
    requireAuth,
    requirePermission(pool, "admin.featured.read"),
    (req, res, next) => p4a.featuredList(req as AuthedRequest, res).catch(next)
  );
  router.put(
    "/admin/featured",
    requireAuth,
    requirePermission(pool, "admin.featured.write"),
    (req, res, next) => p4a.featuredUpsert(req as AuthedRequest, res).catch(next)
  );

  // Plan-compat: role permissions management
  router.get(
    "/admin/roles",
    requireAuth,
    requirePermission(pool, "admin.users.read"),
    (req, res, next) => p4a.adminListRoles(req as AuthedRequest, res).catch(next)
  );
  router.get(
    "/admin/permissions",
    requireAuth,
    requirePermission(pool, "admin.users.read"),
    (req, res, next) => p4a.adminListPermissions(req as AuthedRequest, res).catch(next)
  );
  router.get(
    "/admin/roles/:roleId/permissions",
    requireAuth,
    requirePermission(pool, "admin.users.read"),
    (req, res, next) => p4a.adminGetRolePermissions(req as AuthedRequest, res).catch(next)
  );
  router.put(
    "/admin/roles/:roleId/permissions",
    requireAuth,
    requirePermission(pool, "admin.users.write"),
    (req, res, next) => p4a.adminPutRolePermissions(req as AuthedRequest, res).catch(next)
  );

  // Plan-compat: refund request by paymentId (creates a refund request row)
  router.post(
    "/admin/refunds/:paymentId",
    requireAuth,
    requirePermission(pool, "admin.monetization.write"),
    (req, res, next) => p4a.adminCreateRefundForPayment(req as AuthedRequest, res).catch(next)
  );
}
