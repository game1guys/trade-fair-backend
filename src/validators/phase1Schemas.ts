import { z } from "zod";

export const createEventSchema = z.object({
  categoryId: z.number().int().positive().nullable().optional(),
  title: z.string().min(1).max(255),
  description: z.string().nullable().optional(),
  venueName: z.string().min(1).max(255),
  address: z.string().nullable().optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  isB2b: z.boolean().optional().default(true),
  isB2c: z.boolean().optional().default(true),
  tags: z.array(z.string()).nullable().optional(),
  status: z.enum(["draft", "published"]).optional().default("draft"),
});

export const updateEventSchema = createEventSchema.partial();

export const stallTypeCreateSchema = z.object({
  code: z.string().min(1).max(32),
  name: z.string().min(1).max(128),
  priceMinor: z.number().int().min(0),
  currency: z.string().length(3).default("INR"),
  description: z.string().nullable().optional(),
});

export const stallCreateSchema = z.object({
  stallTypeId: z.string().regex(/^\d+$/),
  label: z.string().min(1).max(64),
  gridRow: z.number().int().nullable().optional(),
  gridCol: z.number().int().nullable().optional(),
});

export const stallBulkCreateSchema = z.object({
  stalls: z
    .array(
      z.object({
        stallTypeId: z.string().regex(/^\d+$/),
        label: z.string().min(1).max(64),
        gridRow: z.number().int().nullable().optional(),
        gridCol: z.number().int().nullable().optional(),
      })
    )
    .min(1)
    .max(500),
});

export const ticketTypeCreateSchema = z.object({
  name: z.string().min(1).max(128),
  priceMinor: z.number().int().min(0),
  quota: z.number().int().min(1),
});

export const exhibitorBookingSchema = z.object({
  stallIds: z.array(z.string().regex(/^\d+$/)).min(1),
});

export const visitorTicketOrderSchema = z.object({
  ticketTypeId: z.string().regex(/^\d+$/),
  quantity: z.number().int().min(1).max(20),
});

export const verifyRazorpaySchema = z.object({
  razorpayOrderId: z.string().min(1),
  razorpayPaymentId: z.string().min(1),
  razorpaySignature: z.string().min(1),
});

/** Plan-compat: generic Razorpay order creation. */
export const razorpayCreateOrderSchema = z.object({
  amountMinor: z.number().int().min(1),
  currency: z.string().length(3).optional().default("INR"),
  receipt: z.string().min(1).max(64),
});

export const scanPayloadSchema = z.object({
  payload: z.string().min(3),
});

export const eventMediaCreateSchema = z.object({
  url: z.string().min(1).max(1024),
  mediaType: z.enum(["image", "video", "other"]).optional().default("image"),
  sortOrder: z.number().int().min(0).optional().default(0),
});

export const announcementCreateSchema = z.object({
  title: z.string().max(255).optional().default(""),
  body: z.string().min(1),
  audience: z.enum(["exhibitors", "visitors", "both"]).optional().default("both"),
});

export const exhibitorProfileSchema = z.object({
  companyName: z.string().max(255).nullable().optional(),
  city: z.string().max(128).nullable().optional(),
  state: z.string().max(128).nullable().optional(),
  country: z.string().max(128).nullable().optional(),
  interests: z.array(z.string()).nullable().optional(),
});

export const stallStatusPatchSchema = z.object({
  status: z.enum(["available", "held", "booked", "blocked"]),
});
