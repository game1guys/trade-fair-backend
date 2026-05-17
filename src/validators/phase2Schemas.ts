import { z } from "zod";

export const adminUsersListSchema = z.object({
  search: z.string().optional(),
  role: z.string().optional(),
  status: z.enum(["active", "inactive", "blocked"]).optional(),
  pendingReview: z.enum(["true", "1"]).optional(),
});

export const adminUserStatusSchema = z.object({
  status: z.enum(["active", "inactive", "blocked"]),
});

export const adminAssignRoleSchema = z.object({
  roleCode: z.string().min(2).max(32),
});

export const adminCreateUserSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8).max(128),
  fullName: z.string().min(1).max(255),
  phone: z.string().max(32).nullable().optional(),
  roleCodes: z.array(z.string().min(2).max(32)).min(1).max(16),
});

export const adminPatchUserSchema = z.object({
  fullName: z.string().min(1).max(255).optional(),
  phone: z.string().max(32).nullable().optional(),
});

export const adminRemoveRoleSchema = z.object({
  roleCode: z.string().min(2).max(32),
});

export const kycSubmitSchema = z.object({
  roleCode: z.string().min(2).max(32),
  docType: z.string().min(2).max(64),
  docUrl: z.string().min(1).max(1024),
  meta: z.record(z.unknown()).optional().nullable(),
});

export const adminKycListSchema = z.object({
  status: z.enum(["submitted", "approved", "rejected"]).optional(),
  roleCode: z.string().optional(),
});

export const adminKycReviewSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  remarks: z.string().max(2000).optional().nullable(),
});

export const subAdminCreateSchema = z
  .object({
    userId: z.string().regex(/^\d+$/).optional(),
    email: z.string().email().max(255).optional(),
    password: z.string().min(8).max(128).optional(),
    fullName: z.string().min(1).max(255).optional(),
    phone: z.string().max(32).nullable().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.userId) return;
    if (!v.email || !v.password || !v.fullName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide userId to promote an existing user, or email + password + fullName to create a new sub-admin",
      });
    }
  });

export const subAdminScopesPutSchema = z.object({
  scopes: z.array(z.string().min(1).max(64)).max(50),
});

export const supportCreateSchema = z.object({
  category: z.enum(["technical", "billing", "stall_booking", "ticket_booking", "general", "dispute"]).optional().default("general"),
  subject: z.string().min(3).max(255),
  body: z.string().min(3).max(5000),
  priority: z.enum(["low", "normal", "high"]).optional().default("normal"),
  disputeId: z.string().regex(/^\d+$/).optional().nullable(),
});

export const supportResponseCreateSchema = z.object({
  body: z.string().min(1).max(5000),
});

export const supportAttachmentCreateSchema = z.object({
  responseId: z.string().regex(/^\d+$/).optional().nullable(),
  fileUrl: z.string().min(1).max(1024),
  fileName: z.string().min(1).max(255),
  fileSize: z.number().int().positive(),
  mimeType: z.string().min(1).max(128),
});

export const adminSupportPatchSchema = z.object({
  status: z.enum(["open", "in_progress", "resolved", "closed"]).optional(),
  assignedToUserId: z.string().regex(/^\d+$/).nullable().optional(),
  priority: z.enum(["low", "normal", "high"]).optional(),
});

export const settingsPutSchema = z.object({
  value: z.unknown(),
});

export const adminNotificationTemplateUpsertSchema = z.object({
  id: z.string().regex(/^\d+$/).optional().nullable(),
  code: z.string().min(2).max(64),
  title: z.string().min(2).max(255),
  body: z.string().min(2).max(5000),
  audience: z.enum(["all", "organizers", "exhibitors", "visitors"]),
});

export const adminNotificationSendSchema = z.object({
  templateId: z.string().regex(/^\d+$/).optional().nullable(),
  audience: z.enum(["all", "organizers", "exhibitors", "visitors"]),
  payload: z.record(z.unknown()).optional().nullable(),
});

export const adminNotificationsListSchema = z.object({
  limit: z.string().regex(/^\d+$/).optional(),
});

export const disputeCreateSchema = z.object({
  paymentId: z.string().regex(/^\d+$/).optional().nullable(),
});

export const adminDisputesListSchema = z.object({
  status: z.enum(["open", "resolved", "closed"]).optional(),
});

export const adminDisputePatchSchema = z.object({
  status: z.enum(["resolved", "closed"]),
});

