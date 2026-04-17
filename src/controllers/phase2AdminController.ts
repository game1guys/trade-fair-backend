import type { Pool } from "mysql2/promise";
import type { Response } from "express";
import * as auditRepo from "../repositories/auditRepository.js";
import * as kycRepo from "../repositories/kycRepository.js";
import * as settingsRepo from "../repositories/settingsRepository.js";
import * as subScopeRepo from "../repositories/subAdminScopeRepository.js";
import * as supportRepo from "../repositories/supportRepository.js";
import * as userRepo from "../repositories/userRepository.js";
import * as notifRepo from "../repositories/notificationRepository.js";
import * as disputeRepo from "../repositories/disputeRepository.js";
import { HttpError } from "../utils/httpError.js";
import type { AuthedRequest } from "../middlewares/authMiddleware.js";
import {
  adminAssignRoleSchema,
  adminDisputePatchSchema,
  adminDisputesListSchema,
  adminKycListSchema,
  adminKycReviewSchema,
  adminNotificationSendSchema,
  adminNotificationTemplateUpsertSchema,
  adminNotificationsListSchema,
  adminSupportPatchSchema,
  adminUserStatusSchema,
  adminUsersListSchema,
  settingsPutSchema,
  subAdminCreateSchema,
  subAdminScopesPutSchema,
} from "../validators/phase2Schemas.js";

function pid(v: string | string[] | undefined): bigint {
  const s = Array.isArray(v) ? v[0] : v;
  if (!s) throw new HttpError(400, "Missing id");
  return BigInt(s);
}

export function createPhase2AdminController(pool: Pool) {
  return {
    adminListUsers: async (req: AuthedRequest, res: Response) => {
      const q = adminUsersListSchema.parse({
        search: typeof req.query.search === "string" ? req.query.search : undefined,
        role: typeof req.query.role === "string" ? req.query.role : undefined,
        status: typeof req.query.status === "string" ? req.query.status : undefined,
      });
      const users = await userRepo.listUsers(pool, {
        search: q.search,
        role: q.role,
        status: q.status,
      });
      res.json({ users });
    },

    adminPatchUserStatus: async (req: AuthedRequest, res: Response) => {
      const userId = pid(req.params.id);
      const body = adminUserStatusSchema.parse(req.body);
      const ok = await userRepo.setUserStatus(pool, userId, body.status);
      if (!ok) throw new HttpError(404, "User not found");
      await auditRepo.insertAuditLog(pool, {
        actorUserId: req.userId!,
        action: "ADMIN_USER_STATUS",
        entityType: "user",
        entityId: String(userId),
        metadata: { status: body.status },
      });
      res.json({ ok: true });
    },

    adminAssignRole: async (req: AuthedRequest, res: Response) => {
      const userId = pid(req.params.id);
      const body = adminAssignRoleSchema.parse(req.body);
      await userRepo.assignRoleByCode(pool, userId, body.roleCode);
      await auditRepo.insertAuditLog(pool, {
        actorUserId: req.userId!,
        action: "ADMIN_ASSIGN_ROLE",
        entityType: "user",
        entityId: String(userId),
        metadata: { roleCode: body.roleCode },
      });
      res.json({ ok: true });
    },

    // --- KYC ---
    adminListKyc: async (req: AuthedRequest, res: Response) => {
      const q = adminKycListSchema.parse({
        status: typeof req.query.status === "string" ? req.query.status : undefined,
        roleCode: typeof req.query.roleCode === "string" ? req.query.roleCode : undefined,
      });
      const items = await kycRepo.adminListKyc(pool, { status: q.status, roleCode: q.roleCode });
      res.json({ kyc: items });
    },

    adminReviewKyc: async (req: AuthedRequest, res: Response) => {
      const docId = pid(req.params.docId);
      const body = adminKycReviewSchema.parse(req.body);
      const ok = await kycRepo.adminReviewKyc(pool, {
        docId,
        reviewerUserId: req.userId!,
        status: body.decision,
        remarks: body.remarks ?? null,
      });
      if (!ok) throw new HttpError(404, "KYC doc not found");
      await auditRepo.insertAuditLog(pool, {
        actorUserId: req.userId!,
        action: "ADMIN_KYC_REVIEW",
        entityType: "kyc_document",
        entityId: String(docId),
        metadata: { decision: body.decision },
      });
      res.json({ ok: true });
    },

    // --- Sub-admin ---
    adminCreateSubAdmin: async (req: AuthedRequest, res: Response) => {
      const body = subAdminCreateSchema.parse(req.body);
      const uid = BigInt(body.userId);
      await userRepo.assignRoleByCode(pool, uid, "SUB_ADMIN");
      await auditRepo.insertAuditLog(pool, {
        actorUserId: req.userId!,
        action: "ADMIN_CREATE_SUB_ADMIN",
        entityType: "user",
        entityId: String(uid),
        metadata: {},
      });
      res.status(201).json({ ok: true });
    },

    adminPutSubAdminScopes: async (req: AuthedRequest, res: Response) => {
      const subAdminUserId = pid(req.params.id);
      const body = subAdminScopesPutSchema.parse(req.body);
      await subScopeRepo.replaceScopesForSubAdmin(pool, subAdminUserId, body.scopes);
      await auditRepo.insertAuditLog(pool, {
        actorUserId: req.userId!,
        action: "ADMIN_SET_SUBADMIN_SCOPES",
        entityType: "user",
        entityId: String(subAdminUserId),
        metadata: { scopes: body.scopes },
      });
      res.json({ ok: true });
    },

    // --- Support ---
    adminListSupport: async (req: AuthedRequest, res: Response) => {
      const tickets = await supportRepo.adminListSupportTickets(pool);
      res.json({ tickets });
    },

    adminPatchSupport: async (req: AuthedRequest, res: Response) => {
      const ticketId = pid(req.params.id);
      const body = adminSupportPatchSchema.parse(req.body);
      const ok = await supportRepo.adminPatchSupportTicket(pool, ticketId, {
        status: body.status,
        priority: body.priority,
        assignedToUserId: body.assignedToUserId != null ? BigInt(body.assignedToUserId) : body.assignedToUserId,
      });
      if (!ok) throw new HttpError(404, "Ticket not found");
      await auditRepo.insertAuditLog(pool, {
        actorUserId: req.userId!,
        action: "ADMIN_SUPPORT_PATCH",
        entityType: "support_ticket",
        entityId: String(ticketId),
        metadata: body,
      });
      res.json({ ok: true });
    },

    // --- Settings (minimal) ---
    adminGetSetting: async (req: AuthedRequest, res: Response) => {
      const key = String(req.params.key ?? "");
      const row = await settingsRepo.getSetting(pool, key);
      res.json({ setting: row });
    },

    adminPutSetting: async (req: AuthedRequest, res: Response) => {
      const key = String(req.params.key ?? "");
      const body = settingsPutSchema.parse(req.body);
      await settingsRepo.upsertSetting(pool, key, body.value, req.userId!);
      await auditRepo.insertAuditLog(pool, {
        actorUserId: req.userId!,
        action: "ADMIN_SETTING_PUT",
        entityType: "system_setting",
        entityId: key,
        metadata: {},
      });
      res.json({ ok: true });
    },

    // --- Notifications (Phase 2) ---
    adminListNotificationTemplates: async (_req: AuthedRequest, res: Response) => {
      const templates = await notifRepo.listTemplates(pool);
      res.json({ templates });
    },

    adminUpsertNotificationTemplate: async (req: AuthedRequest, res: Response) => {
      const body = adminNotificationTemplateUpsertSchema.parse(req.body);
      const id = await notifRepo.upsertTemplate(pool, {
        id: body.id ? BigInt(body.id) : null,
        code: body.code,
        title: body.title,
        body: body.body,
        audience: body.audience,
      });
      await auditRepo.insertAuditLog(pool, {
        actorUserId: req.userId!,
        action: "ADMIN_NOTIFICATION_TEMPLATE_UPSERT",
        entityType: "notification_template",
        entityId: String(id),
        metadata: { code: body.code, audience: body.audience },
      });
      res.json({ id: String(id) });
    },

    adminSendNotification: async (req: AuthedRequest, res: Response) => {
      const body = adminNotificationSendSchema.parse(req.body);
      const templateId = body.templateId ? BigInt(body.templateId) : null;
      const result = await notifRepo.createInAppNotificationsForAudience(pool, {
        templateId,
        audience: body.audience,
        payload: (body.payload as Record<string, unknown> | null) ?? null,
      });
      await auditRepo.insertAuditLog(pool, {
        actorUserId: req.userId!,
        action: "ADMIN_NOTIFICATION_SEND",
        entityType: "notification",
        entityId: null,
        metadata: { audience: body.audience, templateId: body.templateId ?? null, inserted: result.inserted },
      });
      res.status(201).json({ ok: true, inserted: result.inserted });
    },

    adminListNotifications: async (req: AuthedRequest, res: Response) => {
      const q = adminNotificationsListSchema.parse({
        limit: typeof req.query.limit === "string" ? req.query.limit : undefined,
      });
      const limit = q.limit ? Number(q.limit) : 200;
      const notifications = await notifRepo.adminListNotifications(pool, limit);
      res.json({ notifications });
    },

    // --- Disputes (Phase 2 stub) ---
    adminListDisputes: async (req: AuthedRequest, res: Response) => {
      const q = adminDisputesListSchema.parse({
        status: typeof req.query.status === "string" ? req.query.status : undefined,
      });
      const disputes = await disputeRepo.listDisputes(pool, q.status);
      res.json({ disputes });
    },

    adminPatchDispute: async (req: AuthedRequest, res: Response) => {
      const disputeId = pid(req.params.id);
      const body = adminDisputePatchSchema.parse(req.body);
      const ok = await disputeRepo.patchDisputeStatus(pool, disputeId, body.status);
      if (!ok) throw new HttpError(404, "Dispute not found");
      await auditRepo.insertAuditLog(pool, {
        actorUserId: req.userId!,
        action: "ADMIN_DISPUTE_PATCH",
        entityType: "dispute",
        entityId: String(disputeId),
        metadata: { status: body.status },
      });
      res.json({ ok: true });
    },
  };
}

