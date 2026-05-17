import { z } from "zod";

export const providerProfileSchema = z.object({
  companyName: z.string().min(1).max(255),
  tagline: z.string().max(512).optional().nullable(),
  city: z.string().max(128).optional().nullable(),
  state: z.string().max(128).optional().nullable(),
  portfolioUrls: z.array(z.string().url()).optional().nullable(),
  bookingEnabled: z.boolean().optional(),
  publicSlug: z.string().max(64).regex(/^[a-z0-9-]*$/).optional().nullable(),
  /** Years you have been offering services (optional; shown to organisers). */
  yearsInBusiness: z.number().int().min(0).max(80).optional().nullable(),
});

export const organizerProviderRatingSchema = z.object({
  stars: z.number().int().min(1).max(5),
  comment: z.string().max(2000).optional().nullable(),
});

export const serviceCreateSchema = z.object({
  categoryId: z.number().int().positive(),
  eventId: z.string().regex(/^\d+$/).optional().nullable(),
  title: z.string().min(1).max(255),
  description: z.string().max(8000).optional().nullable(),
  priceMinor: z.number().int().nonnegative(),
  currency: z.string().length(3).optional().default("INR"),
  portfolioUrls: z.array(z.string().url()).optional().nullable(),
  /** Cities/regions you serve (plain text). */
  serviceArea: z.string().max(255).optional().nullable(),
  /** Typical advance notice in days (0–365). */
  leadTimeDays: z.number().int().min(0).max(365).optional().nullable(),
  /** What's included, timeline, materials, exclusions — helps organizers decide. */
  deliveryNotes: z.string().max(8000).optional().nullable(),
  status: z.enum(["draft", "published"]),
});

export const servicePatchSchema = serviceCreateSchema.partial().extend({
  /** Remove this gallery/portfolio URL (exact match). */
  removeGalleryUrl: z.string().max(512).optional(),
  /** Listing hero image; must match an uploaded gallery URL or external portfolio URL you saved. */
  coverImageUrl: z.string().max(512).optional().nullable(),
});

export const serviceRequestCreateSchema = z.object({
  message: z.string().min(1).max(8000),
  /** When set, enquiry is tied to this fair — must belong to the requesting organizer (server-checked). */
  eventId: z.string().regex(/^\d+$/).optional().nullable(),
});

export const serviceRequestPatchSchema = z.object({
  status: z.enum(["open", "in_progress", "closed"]).optional(),
  providerResponse: z.string().max(8000).optional().nullable(),
});

export const serviceRequestMessageCreateSchema = z.object({
  body: z.string().min(1).max(8000),
});

const machineryItemSchema = z.object({
  name: z.string().min(1).max(255),
  count: z.number().int().min(0).max(100000),
  details: z.string().max(2000).optional().nullable(),
});

/** Organizer sends contract after chat — listing/category already fixed on the enquiry. */
export const serviceRequestContractSendSchema = z.object({
  durationDays: z.number().int().min(1).max(3650),
  peopleCount: z.number().int().min(1).max(10_000_000),
  /** Fair-specific scope (dates, venue notes) — not “which service”. */
  organizerNotes: z.string().max(4000).optional().nullable(),
});

/** Provider fills manpower & machinery, then accepts → deal done. */
export const serviceRequestContractDeclineSchema = z.object({
  providerNotes: z.string().max(4000).optional().nullable(),
});

export const serviceRequestContractAcceptSchema = z.object({
  manpowerAvailable: z.number().int().min(1).max(10_000_000),
  machinery: z.array(machineryItemSchema).max(50),
  providerNotes: z.string().max(4000).optional().nullable(),
});

export const providerBookingCreateSchema = z.object({
  serviceId: z.string().regex(/^\d+$/),
  customerUserId: z.string().regex(/^\d+$/),
  serviceRequestId: z.string().regex(/^\d+$/).optional().nullable(),
  scheduledAt: z.string().optional().nullable(),
  amountMinor: z.number().int().positive(),
  currency: z.string().length(3).optional().default("INR"),
});

export const providerServiceBookingPatchSchema = z
  .object({
    status: z.enum(["confirmed", "rejected", "completed", "cancelled"]).optional(),
    /** ISO string or datetime-local; null clears schedule */
    scheduledAt: z.union([z.string(), z.null()]).optional(),
  })
  .refine((b) => b.status !== undefined || b.scheduledAt !== undefined, {
    message: "Provide status and/or scheduledAt",
  })
  .superRefine((b, ctx) => {
    if (b.scheduledAt != null && b.scheduledAt !== "" && Number.isNaN(Date.parse(b.scheduledAt))) {
      ctx.addIssue({ code: "custom", message: "Invalid scheduledAt", path: ["scheduledAt"] });
    }
  });

export const serviceReviewCreateSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(4000).optional().nullable(),
});

export const subscriptionPlanSchema = z
  .object({
    id: z.number().int().positive().optional(),
    name: z.string().min(1).max(128),
    description: z.string().max(2000).optional().nullable(),
    priceMinor: z.number().int().nonnegative(),
    durationDays: z.number().int().positive(),
    active: z.boolean(),
    targetRoleCode: z.enum(["ORGANIZER", "SERVICE_PROVIDER"]),
    /** JSON object, e.g. maxEventsTotal / maxPublishedEvents (organizer) or maxPublishedServices (service provider) */
    limitations: z.record(z.unknown()).optional().nullable(),
    /** Basis points on each stall booking paid to platform (organizer plans only; must be 0 for service provider). */
    stallBookingCommissionBps: z.number().int().min(0).max(50_000).optional().default(0),
  })
  .superRefine((data, ctx) => {
    if (data.targetRoleCode === "SERVICE_PROVIDER" && (data.stallBookingCommissionBps ?? 0) !== 0) {
      ctx.addIssue({
        code: "custom",
        message: "Service provider plans cannot charge stall-booking commission; use 0.",
        path: ["stallBookingCommissionBps"],
      });
    }
  });

export const subscriptionCheckoutSchema = z.object({
  planId: z.number().int().positive(),
  referralCode: z.string().min(2).max(32).optional(),
});

export const subscriptionReferralValidateSchema = z.object({
  planId: z.number().int().positive(),
  referralCode: z.string().min(2).max(32),
});

export const referralCodeUpsertSchema = z
  .object({
    id: z.number().int().positive().optional(),
    code: z.string().min(2).max(32),
    label: z.string().min(1).max(128),
    targetRoleCode: z.enum(["ORGANIZER", "SERVICE_PROVIDER"]),
    discountType: z.enum(["percent", "fixed_minor"]),
    discountValue: z.number().int().nonnegative(),
    maxRedemptions: z.number().int().positive().nullable().optional(),
    validFrom: z.string().max(40).optional().nullable(),
    validUntil: z.string().max(40).optional().nullable(),
    active: z.boolean().default(true),
  })
  .superRefine((data, ctx) => {
    if (data.discountType === "percent" && (data.discountValue < 1 || data.discountValue > 100)) {
      ctx.addIssue({ code: "custom", message: "Percent discount must be 1–100", path: ["discountValue"] });
    }
    if (data.discountType === "fixed_minor" && data.discountValue < 1) {
      ctx.addIssue({ code: "custom", message: "Fixed discount must be at least 1 paisa", path: ["discountValue"] });
    }
  });

export const subscriptionVerifySchema = z.object({
  paymentId: z.string().regex(/^\d+$/),
  razorpayOrderId: z.string().min(1),
  razorpayPaymentId: z.string().min(1),
  razorpaySignature: z.string().min(1),
});

export const adminSubscribeUserSchema = z.object({
  userId: z.string().regex(/^\d+$/),
  planId: z.number().int().positive(),
});

export const refundRequestSchema = z.object({
  paymentId: z.string().regex(/^\d+$/),
  /** Omit or set to payment total for full refund */
  amountMinor: z.number().int().positive().optional(),
  notes: z.string().max(2000).optional().nullable(),
});
