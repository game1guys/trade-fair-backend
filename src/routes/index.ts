import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Pool } from "mysql2/promise";
import { type Router } from "express";
import multer from "multer";
import rateLimit from "express-rate-limit";
import { createAuthController } from "../controllers/authController.js";
import { createPlacesController } from "../controllers/placesController.js";
import { createPhase1Controller } from "../controllers/phase1Controller.js";
import { createPhase2AdminController } from "../controllers/phase2AdminController.js";
import { createPhase2UserController } from "../controllers/phase2UserController.js";
import { createPhase3Controller } from "../controllers/phase3Controller.js";
import { createPhase4AdminController } from "../controllers/phase4AdminController.js";
import { createVolunteerController } from "../controllers/volunteerController.js";
import { createRazorpayWebhookHandler } from "../controllers/razorpayWebhookController.js";
import { requireAuth, type AuthedRequest } from "../middlewares/authMiddleware.js";
import {
  denyPendingAdminReview,
  ensureRole,
  requireAnyRole,
  requirePermission,
  requireSubAdminScope,
} from "../middlewares/rbacMiddleware.js";

export function registerRoutes(router: Router, pool: Pool, uploadsRoot: string) {
  const auth = createAuthController(pool);
  const places = createPlacesController();
  const p1 = createPhase1Controller(pool);
  const p2a = createPhase2AdminController(pool);
  const p2u = createPhase2UserController(pool);
  const p3 = createPhase3Controller(pool);
  const p4a = createPhase4AdminController(pool);
  const volunteer = createVolunteerController(pool);
  const rzWebhook = createRazorpayWebhookHandler(pool);

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
  });

  const placesLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
  });

  const eventImageUpload = multer({
    storage: multer.diskStorage({
      destination: (req, _file, cb) => {
        const raw = req.params.eventId;
        if (typeof raw !== "string" || !/^\d+$/.test(raw)) {
          cb(new Error("Invalid event id"), "");
          return;
        }
        const dir = path.join(uploadsRoot, "events", raw);
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      },
      filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        const safe = [".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(ext) ? ext : ".jpg";
        cb(null, `${randomUUID()}${safe}`);
      },
    }),
    limits: { fileSize: 6 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const allowed = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
      cb(null, allowed.has(file.mimetype));
    },
  });

  const serviceImageUpload = multer({
    storage: multer.diskStorage({
      destination: (req, _file, cb) => {
        const raw = req.params.serviceId;
        if (typeof raw !== "string" || !/^\d+$/.test(raw)) {
          cb(new Error("Invalid service id"), "");
          return;
        }
        const dir = path.join(uploadsRoot, "services", raw);
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      },
      filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        const safe = [".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(ext) ? ext : ".jpg";
        cb(null, `${randomUUID()}${safe}`);
      },
    }),
    limits: { fileSize: 6 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const allowed = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
      cb(null, allowed.has(file.mimetype));
    },
  });

  const kycDocumentUpload = multer({
    storage: multer.diskStorage({
      destination: (req, _file, cb) => {
        const uid = (req as AuthedRequest).userId;
        if (uid == null) {
          cb(new Error("Unauthorized"), "");
          return;
        }
        const dir = path.join(uploadsRoot, "kyc", String(uid));
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      },
      filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        const safe = [".pdf", ".jpg", ".jpeg", ".png", ".webp"].includes(ext) ? ext : ".bin";
        cb(null, `${randomUUID()}${safe}`);
      },
    }),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const allowed = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);
      cb(null, allowed.has(file.mimetype));
    },
  });

  const volunteerPhotoUpload = multer({
    storage: multer.diskStorage({
      destination: (req, _file, cb) => {
        const uid = (req as AuthedRequest).userId;
        if (uid == null) {
          cb(new Error("Unauthorized"), "");
          return;
        }
        const dir = path.join(uploadsRoot, "volunteers", String(uid));
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      },
      filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        const safe = [".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(ext) ? ext : ".jpg";
        cb(null, `${randomUUID()}${safe}`);
      },
    }),
    limits: { fileSize: 4 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const allowed = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
      cb(null, allowed.has(file.mimetype));
    },
  });

  const supportAttachmentUpload = multer({
    storage: multer.diskStorage({
      destination: (req, _file, cb) => {
        const tid = req.params.id;
        if (typeof tid !== "string" || !/^\d+$/.test(tid)) {
          cb(new Error("Invalid ticket id"), "");
          return;
        }
        const dir = path.join(uploadsRoot, "support", tid);
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      },
      filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        const safe = [".pdf", ".jpg", ".jpeg", ".png", ".webp", ".txt", ".docx"].includes(ext) ? ext : ".bin";
        cb(null, `${randomUUID()}${safe}`);
      },
    }),
    limits: { fileSize: 10 * 1024 * 1024 },
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
  router.post("/auth/otp/request", authLimiter, (req, res, next) =>
    auth.otpRequest(req as AuthedRequest, res).catch(next)
  );
  router.post("/auth/otp/login", authLimiter, (req, res, next) =>
    auth.otpLogin(req as AuthedRequest, res).catch(next)
  );
  router.post("/auth/refresh", authLimiter, (req, res, next) =>
    auth.refresh(req as AuthedRequest, res).catch(next)
  );
  router.post("/auth/logout", (req, res, next) => auth.logout(req as AuthedRequest, res).catch(next));
  router.get("/auth/me", requireAuth, (req, res, next) => auth.me(req as AuthedRequest, res).catch(next));
  router.patch("/auth/me", requireAuth, (req, res, next) => auth.patchMe(req as AuthedRequest, res).catch(next));
  router.post(
    "/auth/phone/request-otp",
    authLimiter,
    requireAuth,
    (req, res, next) => auth.phoneRequestOtp(req as AuthedRequest, res).catch(next)
  );
  router.post(
    "/auth/phone/verify-otp",
    authLimiter,
    requireAuth,
    (req, res, next) => auth.phoneVerifyOtp(req as AuthedRequest, res).catch(next)
  );

  // --- Phase 1: public events (static segments before /events/:eventId) ---
  router.get("/places/suggest", placesLimiter, (req, res, next) =>
    places.suggest(req as AuthedRequest, res).catch(next)
  );
  router.get("/events/categories", (req, res, next) =>
    p1.listPublicEventCategories(req as AuthedRequest, res).catch(next)
  );
  router.get("/events/:eventId/ticket-types", (req, res, next) =>
    p1.publicListTicketTypes(req as AuthedRequest, res).catch(next)
  );
  router.get("/events", (req, res, next) => p1.listPublicEvents(req as AuthedRequest, res).catch(next));
  router.get("/events/:eventId", (req, res, next) => p1.getPublicEvent(req as AuthedRequest, res).catch(next));
  router.post("/events/:eventId/reviews", requireAuth, (req, res, next) =>
    p1.submitEventReview(req as AuthedRequest, res).catch(next)
  );

  router.get("/subscription/plans", (req, res, next) =>
    p3.listPublicSubscriptionPlans(req as AuthedRequest, res).catch(next)
  );
  router.post("/subscription/referral/validate", requireAuth, (req, res, next) =>
    p3.subscriptionValidateReferral(req as AuthedRequest, res).catch(next)
  );
  router.post("/subscription/checkout", requireAuth, (req, res, next) =>
    p3.subscriptionCheckout(req as AuthedRequest, res).catch(next)
  );
  router.post("/subscription/verify", requireAuth, (req, res, next) =>
    p3.subscriptionVerify(req as AuthedRequest, res).catch(next)
  );

  router.get(
    "/organizer/payout-profile",
    requireAuth,
    ensureRole(pool, "ORGANIZER"),
    denyPendingAdminReview(pool),
    (req, res, next) => p1.organizerGetPayoutProfile(req as AuthedRequest, res).catch(next)
  );
  router.put(
    "/organizer/payout-profile",
    requireAuth,
    ensureRole(pool, "ORGANIZER"),
    denyPendingAdminReview(pool),
    (req, res, next) => p1.organizerPutPayoutProfile(req as AuthedRequest, res).catch(next)
  );

  // Organizer (payout profile is account-wide; not per-event)
  router.get(
    "/organizer/events",
    requireAuth,
    ensureRole(pool, "ORGANIZER"),
    denyPendingAdminReview(pool),
    (req, res, next) => p1.organizerListEvents(req as AuthedRequest, res).catch(next)
  );
  router.get(
    "/organizer/events/:eventId/marketplace-services",
    requireAuth,
    ensureRole(pool, "ORGANIZER"),
    denyPendingAdminReview(pool),
    (req, res, next) => p1.organizerListMarketplaceServicesForEvent(req as AuthedRequest, res).catch(next)
  );
  router.get(
    "/organizer/events/:eventId/marketplace-deals",
    requireAuth,
    ensureRole(pool, "ORGANIZER"),
    denyPendingAdminReview(pool),
    (req, res, next) => p1.organizerListEventMarketplaceDeals(req as AuthedRequest, res).catch(next)
  );
  router.get(
    "/organizer/events/:eventId",
    requireAuth,
    ensureRole(pool, "ORGANIZER"),
    denyPendingAdminReview(pool),
    (req, res, next) => p1.organizerGetEvent(req as AuthedRequest, res).catch(next)
  );
  router.post(
    "/organizer/events",
    requireAuth,
    ensureRole(pool, "ORGANIZER"),
    denyPendingAdminReview(pool),
    (req, res, next) => p1.organizerCreateEvent(req as AuthedRequest, res).catch(next)
  );
  router.patch(
    "/organizer/events/:eventId",
    requireAuth,
    ensureRole(pool, "ORGANIZER"),
    denyPendingAdminReview(pool),
    (req, res, next) => p1.organizerUpdateEvent(req as AuthedRequest, res).catch(next)
  );
  router.post(
    "/organizer/events/:eventId/publish",
    requireAuth,
    ensureRole(pool, "ORGANIZER"),
    denyPendingAdminReview(pool),
    (req, res, next) => p1.organizerPublishEvent(req as AuthedRequest, res).catch(next)
  );
  router.delete(
    "/organizer/events/:eventId",
    requireAuth,
    ensureRole(pool, "ORGANIZER"),
    denyPendingAdminReview(pool),
    (req, res, next) => p1.organizerDeleteEvent(req as AuthedRequest, res).catch(next)
  );
  router.get(
    "/organizer/events/:eventId/stall-types",
    requireAuth,
    ensureRole(pool, "ORGANIZER"),
    denyPendingAdminReview(pool),
    (req, res, next) => p1.organizerListStallTypes(req as AuthedRequest, res).catch(next)
  );
  router.post(
    "/organizer/events/:eventId/stall-types",
    requireAuth,
    ensureRole(pool, "ORGANIZER"),
    denyPendingAdminReview(pool),
    (req, res, next) => p1.organizerCreateStallType(req as AuthedRequest, res).catch(next)
  );
  router.get(
    "/organizer/events/:eventId/stalls",
    requireAuth,
    ensureRole(pool, "ORGANIZER"),
    denyPendingAdminReview(pool),
    (req, res, next) => p1.organizerListStalls(req as AuthedRequest, res).catch(next)
  );
  router.post(
    "/organizer/events/:eventId/stalls",
    requireAuth,
    ensureRole(pool, "ORGANIZER"),
    denyPendingAdminReview(pool),
    (req, res, next) => p1.organizerCreateStall(req as AuthedRequest, res).catch(next)
  );
  router.post(
    "/organizer/events/:eventId/stalls/bulk",
    requireAuth,
    ensureRole(pool, "ORGANIZER"),
    denyPendingAdminReview(pool),
    (req, res, next) => p1.organizerCreateStallsBulk(req as AuthedRequest, res).catch(next)
  );
  router.get(
    "/organizer/events/:eventId/ticket-types",
    requireAuth,
    ensureRole(pool, "ORGANIZER"),
    denyPendingAdminReview(pool),
    (req, res, next) => p1.organizerListTicketTypes(req as AuthedRequest, res).catch(next)
  );
  router.post(
    "/organizer/events/:eventId/ticket-types",
    requireAuth,
    ensureRole(pool, "ORGANIZER"),
    denyPendingAdminReview(pool),
    (req, res, next) => p1.organizerCreateTicketType(req as AuthedRequest, res).catch(next)
  );
  router.patch(
    "/organizer/events/:eventId/ticket-types/:ticketTypeId",
    requireAuth,
    ensureRole(pool, "ORGANIZER"),
    denyPendingAdminReview(pool),
    (req, res, next) => p1.organizerUpdateTicketType(req as AuthedRequest, res).catch(next)
  );
  router.delete(
    "/organizer/events/:eventId/ticket-types/:ticketTypeId",
    requireAuth,
    ensureRole(pool, "ORGANIZER"),
    denyPendingAdminReview(pool),
    (req, res, next) => p1.organizerDeleteTicketType(req as AuthedRequest, res).catch(next)
  );
  router.post(
    "/organizer/events/:eventId/entry/scan",
    requireAuth,
    ensureRole(pool, "ORGANIZER"),
    denyPendingAdminReview(pool),
    (req, res, next) => p1.organizerScanEntry(req as AuthedRequest, res).catch(next)
  );
  router.get(
    "/organizer/volunteers",
    requireAuth,
    ensureRole(pool, "ORGANIZER"),
    denyPendingAdminReview(pool),
    (req, res, next) => volunteer.organizerListVolunteers(req as AuthedRequest, res).catch(next)
  );
  router.post(
    "/organizer/volunteers",
    requireAuth,
    ensureRole(pool, "ORGANIZER"),
    denyPendingAdminReview(pool),
    volunteerPhotoUpload.single("photo"),
    (req, res, next) => volunteer.organizerCreateVolunteer(req as AuthedRequest, res).catch(next)
  );
  router.get(
    "/organizer/events/:eventId/volunteers",
    requireAuth,
    ensureRole(pool, "ORGANIZER"),
    denyPendingAdminReview(pool),
    (req, res, next) => volunteer.organizerListEventVolunteers(req as AuthedRequest, res).catch(next)
  );
  router.post(
    "/organizer/events/:eventId/volunteers/assign",
    requireAuth,
    ensureRole(pool, "ORGANIZER"),
    denyPendingAdminReview(pool),
    (req, res, next) => volunteer.organizerAssignVolunteer(req as AuthedRequest, res).catch(next)
  );
  router.post(
    "/organizer/events/:eventId/volunteers",
    requireAuth,
    ensureRole(pool, "ORGANIZER"),
    denyPendingAdminReview(pool),
    volunteerPhotoUpload.single("photo"),
    (req, res, next) => volunteer.organizerCreateAndAssignVolunteer(req as AuthedRequest, res).catch(next)
  );
  router.delete(
    "/organizer/events/:eventId/volunteers/:volunteerId",
    requireAuth,
    ensureRole(pool, "ORGANIZER"),
    denyPendingAdminReview(pool),
    (req, res, next) => volunteer.organizerUnassignVolunteer(req as AuthedRequest, res).catch(next)
  );
  router.get(
    "/volunteer/events",
    requireAuth,
    ensureRole(pool, "VOLUNTEER"),
    (req, res, next) => volunteer.volunteerListEvents(req as AuthedRequest, res).catch(next)
  );
  router.get(
    "/volunteer/me",
    requireAuth,
    ensureRole(pool, "VOLUNTEER"),
    (req, res, next) => volunteer.volunteerMe(req as AuthedRequest, res).catch(next)
  );
  router.post(
    "/volunteer/events/:eventId/entry/scan",
    requireAuth,
    ensureRole(pool, "VOLUNTEER"),
    (req, res, next) => volunteer.volunteerScanEntry(req as AuthedRequest, res).catch(next)
  );
  router.get(
    "/organizer/events/:eventId/bookings",
    requireAuth,
    ensureRole(pool, "ORGANIZER"),
    denyPendingAdminReview(pool),
    (req, res, next) => p1.organizerListEventBookings(req as AuthedRequest, res).catch(next)
  );
  router.get(
    "/organizer/events/:eventId/tickets",
    requireAuth,
    ensureRole(pool, "ORGANIZER"),
    denyPendingAdminReview(pool),
    (req, res, next) => p1.organizerListEventTickets(req as AuthedRequest, res).catch(next)
  );
  router.get(
    "/organizer/events/:eventId/entry-scans",
    requireAuth,
    ensureRole(pool, "ORGANIZER"),
    denyPendingAdminReview(pool),
    (req, res, next) => p1.organizerListEventEntryScans(req as AuthedRequest, res).catch(next)
  );
  router.get(
    "/organizer/events/:eventId/entry/logs",
    requireAuth,
    ensureRole(pool, "ORGANIZER"),
    denyPendingAdminReview(pool),
    (req, res, next) => p1.organizerListEventEntryLogs(req as AuthedRequest, res).catch(next)
  );
  router.get(
    "/organizer/events/:eventId/media",
    requireAuth,
    ensureRole(pool, "ORGANIZER"),
    denyPendingAdminReview(pool),
    (req, res, next) => p1.organizerListEventMedia(req as AuthedRequest, res).catch(next)
  );
  router.post(
    "/organizer/events/:eventId/media",
    requireAuth,
    ensureRole(pool, "ORGANIZER"),
    denyPendingAdminReview(pool),
    (req, res, next) => p1.organizerAddEventMedia(req as AuthedRequest, res).catch(next)
  );
  router.post(
    "/organizer/events/:eventId/media/upload",
    requireAuth,
    ensureRole(pool, "ORGANIZER"),
    denyPendingAdminReview(pool),
    eventImageUpload.single("file"),
    (req, res, next) => p1.organizerUploadEventMedia(req as AuthedRequest, res).catch(next)
  );
  router.delete(
    "/organizer/events/:eventId/media/:mediaId",
    requireAuth,
    ensureRole(pool, "ORGANIZER"),
    denyPendingAdminReview(pool),
    (req, res, next) => p1.organizerDeleteEventMedia(req as AuthedRequest, res).catch(next)
  );
  router.get(
    "/organizer/events/:eventId/announcements",
    requireAuth,
    ensureRole(pool, "ORGANIZER"),
    denyPendingAdminReview(pool),
    (req, res, next) => p1.organizerListAnnouncements(req as AuthedRequest, res).catch(next)
  );
  router.post(
    "/organizer/events/:eventId/announcements",
    requireAuth,
    ensureRole(pool, "ORGANIZER"),
    denyPendingAdminReview(pool),
    (req, res, next) => p1.organizerCreateAnnouncement(req as AuthedRequest, res).catch(next)
  );
  router.patch(
    "/organizer/events/:eventId/announcements/:announcementId",
    requireAuth,
    ensureRole(pool, "ORGANIZER"),
    denyPendingAdminReview(pool),
    (req, res, next) => p1.organizerPatchAnnouncement(req as AuthedRequest, res).catch(next)
  );
  router.delete(
    "/organizer/events/:eventId/announcements/:announcementId",
    requireAuth,
    ensureRole(pool, "ORGANIZER"),
    denyPendingAdminReview(pool),
    (req, res, next) => p1.organizerDeleteAnnouncement(req as AuthedRequest, res).catch(next)
  );
  router.get(
    "/organizer/events/:eventId/reports/summary",
    requireAuth,
    ensureRole(pool, "ORGANIZER"),
    denyPendingAdminReview(pool),
    (req, res, next) => p1.organizerGetEventReports(req as AuthedRequest, res).catch(next)
  );
  router.get(
    "/organizer/events/:eventId/reports/export.csv",
    requireAuth,
    ensureRole(pool, "ORGANIZER"),
    denyPendingAdminReview(pool),
    (req, res, next) => p1.organizerExportEventReportsCsv(req as AuthedRequest, res).catch(next)
  );
  router.delete(
    "/organizer/events/:eventId/bookings/:bookingId",
    requireAuth,
    ensureRole(pool, "ORGANIZER"),
    denyPendingAdminReview(pool),
    (req, res, next) => p1.organizerCancelEventBooking(req as AuthedRequest, res).catch(next)
  );
  router.post(
    "/organizer/events/:eventId/bookings/:bookingId/approve",
    requireAuth,
    ensureRole(pool, "ORGANIZER"),
    denyPendingAdminReview(pool),
    (req, res, next) => p1.organizerApproveEventBooking(req as AuthedRequest, res).catch(next)
  );
  router.post(
    "/organizer/events/:eventId/bookings/:bookingId/reassign-stall",
    requireAuth,
    ensureRole(pool, "ORGANIZER"),
    denyPendingAdminReview(pool),
    (req, res, next) => p1.organizerReassignBookingStall(req as AuthedRequest, res).catch(next)
  );
  /** SSE live gate — auth via Bearer or ?access_token= for EventSource. */
  router.get("/organizer/events/:eventId/gate/live", (req, res, next) =>
    p1.organizerGateLiveStream(req as AuthedRequest, res).catch(next)
  );
  router.patch(
    "/organizer/events/:eventId/stall-types/:stallTypeId",
    requireAuth,
    ensureRole(pool, "ORGANIZER"),
    denyPendingAdminReview(pool),
    (req, res, next) => p1.organizerUpdateStallType(req as AuthedRequest, res).catch(next)
  );
  router.delete(
    "/organizer/events/:eventId/stall-types/:stallTypeId",
    requireAuth,
    ensureRole(pool, "ORGANIZER"),
    denyPendingAdminReview(pool),
    (req, res, next) => p1.organizerDeleteStallType(req as AuthedRequest, res).catch(next)
  );
  router.delete(
    "/organizer/events/:eventId/stalls/:stallId",
    requireAuth,
    ensureRole(pool, "ORGANIZER"),
    denyPendingAdminReview(pool),
    (req, res, next) => p1.organizerDeleteStallUnit(req as AuthedRequest, res).catch(next)
  );
  router.get(
    "/organizer/events/:eventId/reminders",
    requireAuth,
    ensureRole(pool, "ORGANIZER"),
    denyPendingAdminReview(pool),
    (req, res, next) => p1.organizerListReminders(req as AuthedRequest, res).catch(next)
  );
  router.post(
    "/organizer/events/:eventId/reminders",
    requireAuth,
    ensureRole(pool, "ORGANIZER"),
    denyPendingAdminReview(pool),
    (req, res, next) => p1.organizerCreateReminder(req as AuthedRequest, res).catch(next)
  );
  router.patch(
    "/organizer/events/:eventId/reminders/:reminderId",
    requireAuth,
    ensureRole(pool, "ORGANIZER"),
    denyPendingAdminReview(pool),
    (req, res, next) => p1.organizerPatchReminder(req as AuthedRequest, res).catch(next)
  );
  router.delete(
    "/organizer/events/:eventId/reminders/:reminderId",
    requireAuth,
    ensureRole(pool, "ORGANIZER"),
    denyPendingAdminReview(pool),
    (req, res, next) => p1.organizerDeleteReminder(req as AuthedRequest, res).catch(next)
  );
  router.get(
    "/organizer/events/:eventId/communications/log",
    requireAuth,
    ensureRole(pool, "ORGANIZER"),
    denyPendingAdminReview(pool),
    (req, res, next) => p1.organizerListCommunicationLogs(req as AuthedRequest, res).catch(next)
  );
  router.post(
    "/organizer/events/:eventId/communications/bulk",
    requireAuth,
    ensureRole(pool, "ORGANIZER"),
    denyPendingAdminReview(pool),
    (req, res, next) => p1.organizerBulkCommunicate(req as AuthedRequest, res).catch(next)
  );
  router.patch(
    "/organizer/events/:eventId/stalls/:stallId",
    requireAuth,
    ensureRole(pool, "ORGANIZER"),
    denyPendingAdminReview(pool),
    (req, res, next) => p1.organizerPatchStall(req as AuthedRequest, res).catch(next)
  );
  router.patch(
    "/organizer/stalls/:stallId/status",
    requireAuth,
    ensureRole(pool, "ORGANIZER"),
    denyPendingAdminReview(pool),
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
    ensureRole(pool, "EXHIBITOR"),
    (req, res, next) => p1.exhibitorListEvents(req as AuthedRequest, res).catch(next)
  );
  router.post(
    "/exhibitor/favorites/:eventId",
    requireAuth,
    ensureRole(pool, "EXHIBITOR"),
    (req, res, next) => p1.exhibitorAddEventFavorite(req as AuthedRequest, res).catch(next)
  );
  router.delete(
    "/exhibitor/favorites/:eventId",
    requireAuth,
    ensureRole(pool, "EXHIBITOR"),
    (req, res, next) => p1.exhibitorRemoveEventFavorite(req as AuthedRequest, res).catch(next)
  );
  router.get(
    "/exhibitor/events/:eventId/stalls",
    requireAuth,
    ensureRole(pool, "EXHIBITOR"),
    (req, res, next) => p1.exhibitorListEventStalls(req as AuthedRequest, res).catch(next)
  );
  router.post(
    "/exhibitor/stalls/:stallId/hold",
    requireAuth,
    ensureRole(pool, "EXHIBITOR"),
    (req, res, next) => p1.exhibitorHoldStall(req as AuthedRequest, res).catch(next)
  );
  router.get(
    "/exhibitor/events/:eventId/catalog",
    requireAuth,
    ensureRole(pool, "EXHIBITOR"),
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
    ensureRole(pool, "EXHIBITOR"),
    (req, res, next) => p1.exhibitorListPayments(req as AuthedRequest, res).catch(next)
  );
  router.get(
    "/exhibitor/bookings",
    requireAuth,
    ensureRole(pool, "EXHIBITOR"),
    (req, res, next) => p1.exhibitorListBookings(req as AuthedRequest, res).catch(next)
  );
  router.post(
    "/exhibitor/bookings/:bookingId/refund-request",
    requireAuth,
    ensureRole(pool, "EXHIBITOR"),
    (req, res, next) => p1.exhibitorRequestBookingRefund(req as AuthedRequest, res).catch(next)
  );
  router.post(
    "/exhibitor/events/:eventId/bookings",
    requireAuth,
    ensureRole(pool, "EXHIBITOR"),
    (req, res, next) => p1.exhibitorCreateBooking(req as AuthedRequest, res).catch(next)
  );
  router.post(
    "/exhibitor/bookings/:bookingId/pay/verify",
    requireAuth,
    ensureRole(pool, "EXHIBITOR"),
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
    "/organizer/marketplace/accepted-contracts",
    requireAuth,
    requireAnyRole(pool, "ORGANIZER"),
    denyPendingAdminReview(pool),
    (req, res, next) => p3.organizerListAcceptedContracts(req as AuthedRequest, res).catch(next)
  );
  router.get(
    "/marketplace/service-requests/:requestId/messages",
    requireAuth,
    (req, res, next) => p3.listServiceRequestThread(req as AuthedRequest, res).catch(next)
  );
  router.post(
    "/marketplace/service-requests/:requestId/messages",
    requireAuth,
    (req, res, next) => p3.postServiceRequestMessage(req as AuthedRequest, res).catch(next)
  );
  router.post(
    "/marketplace/service-requests/:requestId/contract",
    requireAuth,
    requireAnyRole(pool, "ORGANIZER"),
    denyPendingAdminReview(pool),
    (req, res, next) => p3.organizerSendServiceContract(req as AuthedRequest, res).catch(next)
  );
  router.put(
    "/marketplace/providers/:providerUserId/organizer-rating",
    requireAuth,
    requireAnyRole(pool, "ORGANIZER"),
    denyPendingAdminReview(pool),
    (req, res, next) => p3.organizerUpsertProviderRating(req as AuthedRequest, res).catch(next)
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
    denyPendingAdminReview(pool),
    (req, res, next) => p3.providerListServices(req as AuthedRequest, res).catch(next)
  );
  router.post(
    "/provider/services",
    requireAuth,
    requireAnyRole(pool, "SERVICE_PROVIDER"),
    denyPendingAdminReview(pool),
    (req, res, next) => p3.providerCreateService(req as AuthedRequest, res).catch(next)
  );
  router.patch(
    "/provider/services/:serviceId",
    requireAuth,
    requireAnyRole(pool, "SERVICE_PROVIDER"),
    denyPendingAdminReview(pool),
    (req, res, next) => p3.providerPatchService(req as AuthedRequest, res).catch(next)
  );
  router.post(
    "/provider/services/:serviceId/images/upload",
    requireAuth,
    requireAnyRole(pool, "SERVICE_PROVIDER"),
    denyPendingAdminReview(pool),
    serviceImageUpload.single("file"),
    (req, res, next) => p3.providerUploadServiceImage(req as AuthedRequest, res).catch(next)
  );
  router.get(
    "/provider/service-requests",
    requireAuth,
    requireAnyRole(pool, "SERVICE_PROVIDER"),
    denyPendingAdminReview(pool),
    (req, res, next) => p3.providerListRequests(req as AuthedRequest, res).catch(next)
  );
  router.patch(
    "/provider/service-requests/:requestId",
    requireAuth,
    requireAnyRole(pool, "SERVICE_PROVIDER"),
    denyPendingAdminReview(pool),
    (req, res, next) => p3.providerPatchRequest(req as AuthedRequest, res).catch(next)
  );
  router.get(
    "/provider/service-requests/:requestId/messages",
    requireAuth,
    requireAnyRole(pool, "SERVICE_PROVIDER"),
    denyPendingAdminReview(pool),
    (req, res, next) => p3.listServiceRequestThread(req as AuthedRequest, res).catch(next)
  );
  router.post(
    "/provider/service-requests/:requestId/messages",
    requireAuth,
    requireAnyRole(pool, "SERVICE_PROVIDER"),
    denyPendingAdminReview(pool),
    (req, res, next) => p3.postServiceRequestMessage(req as AuthedRequest, res).catch(next)
  );
  router.post(
    "/provider/service-requests/:requestId/contract/accept",
    requireAuth,
    requireAnyRole(pool, "SERVICE_PROVIDER"),
    denyPendingAdminReview(pool),
    (req, res, next) => p3.providerAcceptServiceContract(req as AuthedRequest, res).catch(next)
  );
  router.post(
    "/provider/service-requests/:requestId/contract/decline",
    requireAuth,
    requireAnyRole(pool, "SERVICE_PROVIDER"),
    denyPendingAdminReview(pool),
    (req, res, next) => p3.providerDeclineServiceContract(req as AuthedRequest, res).catch(next)
  );
  router.post(
    "/provider/service-bookings",
    requireAuth,
    requireAnyRole(pool, "SERVICE_PROVIDER"),
    denyPendingAdminReview(pool),
    (req, res, next) => p3.providerCreateBooking(req as AuthedRequest, res).catch(next)
  );
  router.get(
    "/provider/service-bookings",
    requireAuth,
    requireAnyRole(pool, "SERVICE_PROVIDER"),
    denyPendingAdminReview(pool),
    (req, res, next) => p3.providerListBookings(req as AuthedRequest, res).catch(next)
  );
  router.get(
    "/provider/marketplace/accepted-contracts",
    requireAuth,
    requireAnyRole(pool, "SERVICE_PROVIDER"),
    denyPendingAdminReview(pool),
    (req, res, next) => p3.providerListAcceptedContracts(req as AuthedRequest, res).catch(next)
  );
  router.get(
    "/provider/marketplace/accepted-contracts/:contractId",
    requireAuth,
    requireAnyRole(pool, "SERVICE_PROVIDER"),
    denyPendingAdminReview(pool),
    (req, res, next) => p3.providerGetAcceptedContract(req as AuthedRequest, res).catch(next)
  );
  router.patch(
    "/provider/service-bookings/:bookingId",
    requireAuth,
    requireAnyRole(pool, "SERVICE_PROVIDER"),
    denyPendingAdminReview(pool),
    (req, res, next) => p3.providerPatchBooking(req as AuthedRequest, res).catch(next)
  );
  router.get(
    "/provider/payments",
    requireAuth,
    requireAnyRole(pool, "SERVICE_PROVIDER"),
    denyPendingAdminReview(pool),
    (req, res, next) => p3.providerListPayments(req as AuthedRequest, res).catch(next)
  );
  router.get(
    "/provider/reviews",
    requireAuth,
    requireAnyRole(pool, "SERVICE_PROVIDER"),
    denyPendingAdminReview(pool),
    (req, res, next) => p3.providerListReviews(req as AuthedRequest, res).catch(next)
  );

  // --- Phase 2: user KYC + Support ---
  router.post("/kyc/documents", requireAuth, (req, res, next) =>
    p2u.submitKyc(req as AuthedRequest, res).catch(next)
  );
  router.post(
    "/kyc/documents/upload",
    requireAuth,
    kycDocumentUpload.single("file"),
    (req, res, next) => p2u.uploadKycDocument(req as AuthedRequest, res).catch(next)
  );
  router.get("/kyc/me", requireAuth, (req, res, next) => p2u.listMyKyc(req as AuthedRequest, res).catch(next));

  router.post("/support/tickets", requireAuth, (req, res, next) =>
    p2u.createSupportTicket(req as AuthedRequest, res).catch(next)
  );
  router.get("/support/tickets/me", requireAuth, (req, res, next) =>
    p2u.listMySupportTickets(req as AuthedRequest, res).catch(next)
  );
  router.get("/support/tickets/:id", requireAuth, (req, res, next) =>
    p2u.getSupportTicketDetails(req as AuthedRequest, res).catch(next)
  );
  router.post("/support/tickets/:id/responses", requireAuth, (req, res, next) =>
    p2u.addSupportResponse(req as AuthedRequest, res).catch(next)
  );
  router.post(
    "/support/tickets/:id/attachments",
    requireAuth,
    supportAttachmentUpload.single("file"),
    (req, res, next) => p2u.uploadSupportAttachment(req as AuthedRequest, res).catch(next)
  );
  router.post("/disputes", requireAuth, (req, res, next) => p2u.createDispute(req as AuthedRequest, res).catch(next));
  router.get("/notifications/me", requireAuth, (req, res, next) =>
    p2u.listMyNotifications(req as AuthedRequest, res).catch(next)
  );

  // --- Phase 2: admin ---
  router.post(
    "/admin/users",
    requireAuth,
    requirePermission(pool, "admin.users.write"),
    (req, res, next) => p2a.adminCreateUser(req as AuthedRequest, res).catch(next)
  );
  router.get(
    "/admin/users",
    requireAuth,
    requirePermission(pool, "admin.users.read"),
    (req, res, next) => p2a.adminListUsers(req as AuthedRequest, res).catch(next)
  );
  router.patch(
    "/admin/users/:id",
    requireAuth,
    requirePermission(pool, "admin.users.write"),
    (req, res, next) => p2a.adminPatchUser(req as AuthedRequest, res).catch(next)
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
  router.post(
    "/admin/users/:id/roles/remove",
    requireAuth,
    requirePermission(pool, "admin.users.write"),
    (req, res, next) => p2a.adminRemoveUserRole(req as AuthedRequest, res).catch(next)
  );
  router.post(
    "/admin/users/:id/approve-account",
    requireAuth,
    requirePermission(pool, "admin.users.write"),
    (req, res, next) => p2a.adminApproveUserAccount(req as AuthedRequest, res).catch(next)
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

  router.get(
    "/admin/sub-admins",
    requireAuth,
    requirePermission(pool, "admin.sub_admins.write"),
    (req, res, next) => p2a.adminListSubAdmins(req as AuthedRequest, res).catch(next)
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
    "/admin/support/tickets/:id",
    requireAuth,
    requirePermission(pool, "admin.support.read"),
    requireSubAdminScope(pool, "support"),
    (req, res, next) => p2a.adminGetTicketDetails(req as AuthedRequest, res).catch(next)
  );
  router.post(
    "/admin/support/tickets/:id/responses",
    requireAuth,
    requirePermission(pool, "admin.support.write"),
    requireSubAdminScope(pool, "support"),
    (req, res, next) => p2a.adminAddSupportResponse(req as AuthedRequest, res).catch(next)
  );
  router.post(
    "/admin/support/tickets/:id/attachments",
    requireAuth,
    requirePermission(pool, "admin.support.write"),
    requireSubAdminScope(pool, "support"),
    supportAttachmentUpload.single("file"),
    (req, res, next) => p2a.adminUploadSupportAttachment(req as AuthedRequest, res).catch(next)
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
  router.delete(
    "/admin/notification-templates/:templateId",
    requireAuth,
    requirePermission(pool, "admin.notifications.write"),
    requireSubAdminScope(pool, "notifications"),
    (req, res, next) => p2a.adminDeleteNotificationTemplate(req as AuthedRequest, res).catch(next)
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

  router.get(
    "/admin/transactions",
    requireAuth,
    requirePermission(pool, "admin.transactions.read"),
    (req, res, next) => p2a.adminListTransactions(req as AuthedRequest, res).catch(next)
  );
  router.get(
    "/admin/transactions/:id",
    requireAuth,
    requirePermission(pool, "admin.transactions.read"),
    (req, res, next) => p2a.adminGetTransaction(req as AuthedRequest, res).catch(next)
  );

  // --- Phase 3: admin subscription plans & refunds ---
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
  router.delete(
    "/admin/monetization/subscription-plans/:planId",
    requireAuth,
    requirePermission(pool, "admin.monetization.write"),
    (req, res, next) => p3.adminDeleteSubscriptionPlan(req as AuthedRequest, res).catch(next)
  );
  router.post(
    "/admin/monetization/subscribe-user",
    requireAuth,
    requirePermission(pool, "admin.monetization.write"),
    (req, res, next) => p3.adminSubscribeUser(req as AuthedRequest, res).catch(next)
  );
  router.get(
    "/admin/monetization/referral-codes",
    requireAuth,
    requirePermission(pool, "admin.monetization.read"),
    (req, res, next) => p3.adminListReferralCodes(req as AuthedRequest, res).catch(next)
  );
  router.put(
    "/admin/monetization/referral-codes",
    requireAuth,
    requirePermission(pool, "admin.monetization.write"),
    (req, res, next) => p3.adminUpsertReferralCode(req as AuthedRequest, res).catch(next)
  );
  router.patch(
    "/admin/monetization/referral-codes/:id/active",
    requireAuth,
    requirePermission(pool, "admin.monetization.write"),
    (req, res, next) => p3.adminSetReferralCodeActive(req as AuthedRequest, res).catch(next)
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
    "/admin/catalog/drafts",
    requireAuth,
    requirePermission(pool, "admin.moderation.read"),
    requireSubAdminScope(pool, "moderation"),
    (req, res, next) => p4a.adminCatalogDrafts(req as AuthedRequest, res).catch(next)
  );
  router.post(
    "/admin/catalog/events/:eventId/publish",
    requireAuth,
    requirePermission(pool, "admin.moderation.write"),
    requireSubAdminScope(pool, "moderation"),
    (req, res, next) => p4a.adminPublishCatalogEvent(req as AuthedRequest, res).catch(next)
  );
  router.post(
    "/admin/catalog/services/:serviceId/publish",
    requireAuth,
    requirePermission(pool, "admin.moderation.write"),
    requireSubAdminScope(pool, "moderation"),
    (req, res, next) => p4a.adminPublishCatalogService(req as AuthedRequest, res).catch(next)
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
  router.delete(
    "/admin/featured/:featureId",
    requireAuth,
    requirePermission(pool, "admin.featured.write"),
    (req, res, next) => p4a.featuredDelete(req as AuthedRequest, res).catch(next)
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
  router.get(
    "/admin/rbac/matrix",
    requireAuth,
    requirePermission(pool, "admin.users.read"),
    (req, res, next) => p4a.adminRbacMatrixGet(req as AuthedRequest, res).catch(next)
  );
  router.put(
    "/admin/rbac/matrix",
    requireAuth,
    requirePermission(pool, "admin.users.write"),
    (req, res, next) => p4a.adminRbacMatrixPut(req as AuthedRequest, res).catch(next)
  );

  // Plan-compat: refund request by paymentId (creates a refund request row)
  router.post(
    "/admin/refunds/:paymentId",
    requireAuth,
    requirePermission(pool, "admin.monetization.write"),
    (req, res, next) => p4a.adminCreateRefundForPayment(req as AuthedRequest, res).catch(next)
  );
}
