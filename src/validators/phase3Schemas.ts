import { z } from "zod";

export const providerProfileSchema = z.object({
  companyName: z.string().min(1).max(255),
  tagline: z.string().max(512).optional().nullable(),
  city: z.string().max(128).optional().nullable(),
  state: z.string().max(128).optional().nullable(),
  portfolioUrls: z.array(z.string().url()).optional().nullable(),
  bookingEnabled: z.boolean().optional(),
  publicSlug: z.string().max(64).regex(/^[a-z0-9-]*$/).optional().nullable(),
});

export const serviceCreateSchema = z.object({
  categoryId: z.number().int().positive(),
  eventId: z.string().regex(/^\d+$/).optional().nullable(),
  title: z.string().min(1).max(255),
  description: z.string().max(8000).optional().nullable(),
  priceMinor: z.number().int().nonnegative(),
  currency: z.string().length(3).optional().default("INR"),
  portfolioUrls: z.array(z.string().url()).optional().nullable(),
  status: z.enum(["draft", "published"]),
});

export const servicePatchSchema = serviceCreateSchema.partial();

export const serviceRequestCreateSchema = z.object({
  message: z.string().min(1).max(8000),
});

export const serviceRequestPatchSchema = z.object({
  status: z.enum(["open", "in_progress", "closed"]).optional(),
  providerResponse: z.string().max(8000).optional().nullable(),
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

export const revenueModelSchema = z.object({
  mode: z.enum(["commission", "subscription"]),
});

export const commissionRuleSchema = z.object({
  id: z.number().int().positive().optional(),
  scopeType: z.enum(["global", "event", "service_category"]),
  eventId: z.string().regex(/^\d+$/).optional().nullable(),
  serviceCategoryId: z.number().int().positive().optional().nullable(),
  commissionBps: z.number().int().min(0).max(50_000),
  active: z.boolean(),
});

export const subscriptionPlanSchema = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().min(1).max(128),
  description: z.string().max(2000).optional().nullable(),
  priceMinor: z.number().int().nonnegative(),
  durationDays: z.number().int().positive(),
  active: z.boolean(),
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
