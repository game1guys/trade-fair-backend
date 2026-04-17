import { z } from "zod";

export const analyticsQuerySchema = z.object({
  days: z.string().regex(/^\d+$/).optional(),
});

export const ledgerQuerySchema = z.object({
  limit: z.string().regex(/^\d+$/).optional(),
});

export const flagsQuerySchema = z.object({
  status: z.enum(["open", "approved", "rejected"]).optional(),
});

export const flagPatchSchema = z.object({
  status: z.enum(["approved", "rejected"]),
});

export const featuredUpsertSchema = z.object({
  entityType: z.string().min(1).max(64),
  entityId: z.string().min(1).max(64),
  label: z.string().max(255).optional().nullable(),
  startsAt: z.string().optional().nullable(),
  endsAt: z.string().optional().nullable(),
  active: z.boolean().optional().default(true),
});

export const rolePermissionsPutSchema = z.object({
  permissionCodes: z.array(z.string().min(1).max(64)).max(500),
});

export const adminRefundCreateSchema = z.object({
  amountMinor: z.number().int().positive().optional(),
  notes: z.string().max(2000).optional().nullable(),
});

