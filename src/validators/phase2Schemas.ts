import { z } from "zod";

export const adminUsersListSchema = z.object({
  search: z.string().optional(),
  role: z.string().optional(),
  status: z.enum(["active", "inactive", "blocked"]).optional(),
});

export const adminUserStatusSchema = z.object({
  status: z.enum(["active", "inactive", "blocked"]),
});

export const adminAssignRoleSchema = z.object({
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

export const subAdminCreateSchema = z.object({
  userId: z.string().regex(/^\d+$/),
});

export const subAdminScopesPutSchema = z.object({
  scopes: z.array(z.string().min(1).max(64)).max(50),
});

export const supportCreateSchema = z.object({
  subject: z.string().min(3).max(255),
  body: z.string().min(3).max(5000),
  priority: z.enum(["low", "normal", "high"]).optional().default("normal"),
});

export const adminSupportPatchSchema = z.object({
  status: z.enum(["open", "in_progress", "resolved", "closed"]).optional(),
  assignedToUserId: z.string().regex(/^\d+$/).nullable().optional(),
  priority: z.enum(["low", "normal", "high"]).optional(),
});

export const settingsPutSchema = z.object({
  value: z.unknown(),
});

