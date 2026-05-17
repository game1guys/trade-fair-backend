import { z } from "zod";

export const createEventSchema = z.object({
  categoryId: z.number().int().positive().nullable().optional(),
  /** Multiple product/event categories (stored in event_category_links). */
  categoryIds: z.array(z.number().int().positive()).max(32).optional(),
  /** When true, exhibitor stall bookings stay pending until organizer approves (then payment opens if paid). */
  requireBookingApproval: z.boolean().optional().default(false),
  /** When true, the same visitor ticket QR can be scanned at the gate multiple times (re-entry); ticket stays valid. */
  entryQrAllowReentry: z.boolean().optional().default(false),
  title: z.string().min(1).max(255),
  description: z.string().nullable().optional(),
  venueName: z.string().min(1).max(255),
  venueCity: z.string().max(128).nullable().optional(),
  venueCountry: z.string().max(128).nullable().optional(),
  venueState: z.string().max(128).nullable().optional(),
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

export const stallTypeUpdateSchema = stallTypeCreateSchema.partial().refine(
  (b) => b.code != null || b.name != null || b.priceMinor != null || b.currency != null || b.description !== undefined,
  { message: "Provide at least one field" }
);

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

export const ticketTypeUpdateSchema = z
  .object({
    name: z.string().min(1).max(128).optional(),
    priceMinor: z.number().int().min(0).optional(),
    quota: z.number().int().min(1).optional(),
  })
  .refine((b) => b.name !== undefined || b.priceMinor !== undefined || b.quota !== undefined, {
    message: "Provide at least one field to update",
  });

export const exhibitorBookingSchema = z.object({
  stallIds: z.array(z.string().regex(/^\d+$/)).min(1),
});

export const organizerBookingReassignSchema = z.object({
  bookingItemId: z.string().regex(/^\d+$/),
  newStallId: z.string().regex(/^\d+$/),
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

export const announcementPatchSchema = announcementCreateSchema.partial().refine(
  (b) => b.title !== undefined || b.body !== undefined || b.audience !== undefined,
  { message: "Provide at least one field to update" }
);

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

/** Organizer PATCH stall: status and/or layout / type reassignment (when rules allow). */
export const stallOrganizerPatchSchema = z
  .object({
    status: z.enum(["available", "held", "booked", "blocked"]).optional(),
    label: z.string().min(1).max(64).optional(),
    gridRow: z.number().int().nullable().optional(),
    gridCol: z.number().int().nullable().optional(),
    stallTypeId: z.string().regex(/^\d+$/).optional(),
  })
  .refine(
    (b) =>
      b.status != null ||
      b.label != null ||
      b.gridRow !== undefined ||
      b.gridCol !== undefined ||
      b.stallTypeId != null,
    { message: "Provide at least one field" }
  );

export const eventReminderCreateSchema = z.object({
  remindAt: z.string().datetime(),
  channel: z.enum(["email", "whatsapp", "both"]).optional().default("email"),
  title: z.string().max(255).optional().default(""),
  body: z.string().min(1),
  audience: z.enum(["exhibitors", "visitors", "both"]).optional().default("both"),
});

export const eventReminderPatchSchema = eventReminderCreateSchema
  .partial()
  .extend({
    status: z.enum(["scheduled", "sent", "cancelled"]).optional(),
  })
  .refine(
    (b) =>
      b.remindAt != null ||
      b.channel != null ||
      b.title !== undefined ||
      b.body != null ||
      b.audience != null ||
      b.status != null,
    { message: "Provide at least one field" }
  );

export const organizerBulkCommunicationSchema = z.object({
  channel: z.enum(["email", "whatsapp", "in_app"]),
  audience: z.enum(["exhibitors", "visitors", "both"]),
  subject: z.string().max(255).optional(),
  body: z.string().min(1),
});

export const organizerPayoutProfilePutSchema = z
  .object({
    accountHolderName: z.string().max(255).optional().default(""),
    bankAccountNumber: z.string().max(32).nullable().optional(),
    ifsc: z.string().max(20).nullable().optional(),
    upiId: z.string().max(255).nullable().optional(),
    razorpayLinkedAccountId: z.string().max(64).nullable().optional(),
    /** Optional PAN for Razorpay Route stakeholder KYC (ABCDE1234F). */
    stakeholderPan: z.string().max(10).nullable().optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    const bankNum = (data.bankAccountNumber ?? "").replace(/\s/g, "");
    const ifsc = (data.ifsc ?? "").trim().toUpperCase();
    const upi = (data.upiId ?? "").trim();
    const linked = (data.razorpayLinkedAccountId ?? "").trim();
    const pan = (data.stakeholderPan ?? "").trim().toUpperCase();

    if (bankNum && !/^\d{9,18}$/.test(bankNum)) {
      ctx.addIssue({ code: "custom", message: "Bank account number must be 9–18 digits", path: ["bankAccountNumber"] });
    }
    if (ifsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) {
      ctx.addIssue({ code: "custom", message: "IFSC must look like ABCD0123456", path: ["ifsc"] });
    }
    if (bankNum && !ifsc) {
      ctx.addIssue({ code: "custom", message: "IFSC is required when bank account number is set", path: ["ifsc"] });
    }
    if (ifsc && !bankNum) {
      ctx.addIssue({
        code: "custom",
        message: "Bank account number is required when IFSC is set",
        path: ["bankAccountNumber"],
      });
    }
    if (upi && !/^[\w.\-+]{2,64}@[\w.-]{2,64}$/.test(upi)) {
      ctx.addIssue({ code: "custom", message: "UPI ID looks invalid (e.g. name@paytm)", path: ["upiId"] });
    }
    if (linked && !/^acc_[A-Za-z0-9]+$/.test(linked)) {
      ctx.addIssue({
        code: "custom",
        message: "Linked account id should look like acc_xxxxxxxx",
        path: ["razorpayLinkedAccountId"],
      });
    }

    if (!bankNum && !upi) {
      ctx.addIssue({
        code: "custom",
        message: "Add your UPI ID, or bank account number with IFSC.",
        path: ["upiId"],
      });
    }
    if (pan && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) {
      ctx.addIssue({
        code: "custom",
        message: "PAN must look like ABCDE1234F (10 characters).",
        path: ["stakeholderPan"],
      });
    }
  });
