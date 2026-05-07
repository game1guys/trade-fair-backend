import bcrypt from "bcryptjs";
import type { Pool } from "mysql2/promise";
import type { Response } from "express";
import * as auditRepo from "../repositories/auditRepository.js";
import * as kycRepo from "../repositories/kycRepository.js";
import * as paymentRepo from "../repositories/paymentRepository.js";
import * as settingsRepo from "../repositories/settingsRepository.js";
import * as subScopeRepo from "../repositories/subAdminScopeRepository.js";
import * as supportRepo from "../repositories/supportRepository.js";
import * as userRepo from "../repositories/userRepository.js";
import * as notifRepo from "../repositories/notificationRepository.js";
import * as disputeRepo from "../repositories/disputeRepository.js";
import { env } from "../config/env.js";
import { HttpError } from "../utils/httpError.js";
import type { AuthedRequest } from "../middlewares/authMiddleware.js";
import {
  adminAssignRoleSchema,
  adminCreateUserSchema,
  adminDisputePatchSchema,
  adminDisputesListSchema,
  adminKycListSchema,
  adminKycReviewSchema,
  adminNotificationSendSchema,
  adminNotificationTemplateUpsertSchema,
  adminNotificationsListSchema,
  adminPatchUserSchema,
  adminRemoveRoleSchema,
  adminSupportPatchSchema,
  adminUserStatusSchema,
  adminUsersListSchema,
  settingsPutSchema,
  subAdminCreateSchema,
  subAdminScopesPutSchema,
  supportAttachmentCreateSchema,
  supportResponseCreateSchema,
} from "../validators/phase2Schemas.js";

function pid(v: string | string[] | undefined): bigint {
  const s = Array.isArray(v) ? v[0] : v;
  if (!s) throw new HttpError(400, "Missing id");
  return BigInt(s);
}

const BCRYPT_ROUNDS = 12;

async function actorIsSuperAdmin(pool: Pool, actorUserId: bigint): Promise<boolean> {
  const roles = await userRepo.getRoleCodesForUser(pool, actorUserId);
  return roles.includes("SUPER_ADMIN");
}

export function createPhase2AdminController(pool: Pool) {
  return {
    adminListUsers: async (req: AuthedRequest, res: Response) => {
      const q = adminUsersListSchema.parse({
        search: typeof req.query.search === "string" ? req.query.search : undefined,
        role: typeof req.query.role === "string" ? req.query.role : undefined,
        status: typeof req.query.status === "string" ? req.query.status : undefined,
        pendingReview:
          typeof req.query.pendingReview === "string" ? (req.query.pendingReview as "true" | "1") : undefined,
      });
      const users = await userRepo.listUsers(pool, {
        search: q.search,
        role: q.role,
        status: q.status,
        pendingReview: q.pendingReview === "true" || q.pendingReview === "1",
      });
      res.json({ users });
    },

    adminApproveUserAccount: async (req: AuthedRequest, res: Response) => {
      const userId = pid(req.params.id);
      const ok = await userRepo.approveUserAdminReview(pool, userId);
      if (!ok) throw new HttpError(404, "No pending approval for this user");
      await auditRepo.insertAuditLog(pool, {
        actorUserId: req.userId!,
        action: "ADMIN_USER_APPROVE_ACCOUNT",
        entityType: "user",
        entityId: String(userId),
        metadata: {},
      });
      res.json({ ok: true });
    },

    adminCreateUser: async (req: AuthedRequest, res: Response) => {
      const body = adminCreateUserSchema.parse(req.body);
      if (body.roleCodes.includes("SUPER_ADMIN") && !(await actorIsSuperAdmin(pool, req.userId!))) {
        throw new HttpError(403, "Only super admins can grant SUPER_ADMIN");
      }
      const email = body.email.toLowerCase().trim();
      const existing = await userRepo.findUserByEmail(pool, email);
      if (existing) throw new HttpError(409, "Email already registered");
      const passwordHash = await bcrypt.hash(body.password, BCRYPT_ROUNDS);
      const userId = await userRepo.insertUser(pool, {
        email,
        passwordHash,
        fullName: body.fullName.trim(),
        phone: body.phone ?? null,
      });
      const uniqRoles = [...new Set(body.roleCodes.map((c) => c.trim().toUpperCase()))];
      for (const code of uniqRoles) {
        await userRepo.assignRoleByCode(pool, userId, code);
      }
      await auditRepo.insertAuditLog(pool, {
        actorUserId: req.userId!,
        action: "ADMIN_USER_CREATE",
        entityType: "user",
        entityId: String(userId),
        metadata: { email, roles: uniqRoles },
      });
      res.status(201).json({ user: { id: String(userId), email, fullName: body.fullName.trim() } });
    },

    adminPatchUser: async (req: AuthedRequest, res: Response) => {
      const userId = pid(req.params.id);
      const body = adminPatchUserSchema.parse(req.body);
      if (body.fullName === undefined && body.phone === undefined) {
        throw new HttpError(400, "Provide fullName and/or phone");
      }
      const u = await userRepo.findUserById(pool, userId);
      if (!u) throw new HttpError(404, "User not found");
      await userRepo.updateUserProfile(pool, userId, {
        fullName: body.fullName,
        phone: body.phone,
      });
      await auditRepo.insertAuditLog(pool, {
        actorUserId: req.userId!,
        action: "ADMIN_USER_PROFILE_PATCH",
        entityType: "user",
        entityId: String(userId),
        metadata: {},
      });
      res.json({ ok: true });
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
      const rc = body.roleCode.trim().toUpperCase();
      if (rc === "SUPER_ADMIN" && !(await actorIsSuperAdmin(pool, req.userId!))) {
        throw new HttpError(403, "Only super admins can grant SUPER_ADMIN");
      }
      await userRepo.assignRoleByCode(pool, userId, rc);
      await auditRepo.insertAuditLog(pool, {
        actorUserId: req.userId!,
        action: "ADMIN_ASSIGN_ROLE",
        entityType: "user",
        entityId: String(userId),
        metadata: { roleCode: rc },
      });
      res.json({ ok: true });
    },

    adminRemoveUserRole: async (req: AuthedRequest, res: Response) => {
      const userId = pid(req.params.id);
      const body = adminRemoveRoleSchema.parse(req.body);
      const rc = body.roleCode.trim().toUpperCase();
      if (rc === "SUPER_ADMIN" && !(await actorIsSuperAdmin(pool, req.userId!))) {
        throw new HttpError(403, "Forbidden");
      }
      const ok = await userRepo.removeRoleByCode(pool, userId, rc);
      if (!ok) throw new HttpError(404, "Role assignment not found");
      await auditRepo.insertAuditLog(pool, {
        actorUserId: req.userId!,
        action: "ADMIN_REMOVE_ROLE",
        entityType: "user",
        entityId: String(userId),
        metadata: { roleCode: rc },
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

    adminAddSupportResponse: async (req: AuthedRequest, res: Response) => {
      const ticketId = pid(req.params.id);
      const body = supportResponseCreateSchema.parse(req.body);
      const id = await supportRepo.addTicketResponse(pool, {
        ticketId,
        userId: req.userId!,
        body: body.body,
        isStaffResponse: true,
      });
      await auditRepo.insertAuditLog(pool, {
        actorUserId: req.userId!,
        action: "ADMIN_SUPPORT_RESPONSE",
        entityType: "support_ticket",
        entityId: String(ticketId),
        metadata: { responseId: String(id) },
      });
      res.status(201).json({ id: String(id) });
    },

    adminUploadSupportAttachment: async (req: AuthedRequest, res: Response) => {
      const file = (req as AuthedRequest & { file?: { filename: string; originalname: string; mimetype: string; size: number } }).file;
      if (!file) throw new HttpError(400, 'Missing file (multipart field name "file")');

      const ticketId = pid(req.params.id);
      const responseId = req.body.responseId ? BigInt(req.body.responseId) : null;

      const relativePath = `support/${ticketId}/${file.filename}`;
      const prefix = env.apiPrefix.startsWith("/") ? env.apiPrefix : `/${env.apiPrefix}`;
      const fileUrl = `${prefix}/static/uploads/${relativePath}`;

      const id = await supportRepo.addAttachment(pool, {
        ticketId,
        responseId,
        fileUrl,
        fileName: file.originalname,
        fileSize: file.size,
        mimeType: file.mimetype,
      });
      res.status(201).json({ id: String(id), fileUrl });
    },

    adminGetTicketDetails: async (req: AuthedRequest, res: Response) => {
      const ticketId = pid(req.params.id);
      const responses = await supportRepo.listTicketResponses(pool, ticketId);
      const attachments = await supportRepo.listTicketAttachments(pool, ticketId);
      res.json({ responses, attachments });
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

    adminDeleteNotificationTemplate: async (req: AuthedRequest, res: Response) => {
      const templateId = pid(req.params.templateId);
      const ok = await notifRepo.deleteTemplateById(pool, templateId);
      if (!ok) throw new HttpError(404, "Template not found");
      await auditRepo.insertAuditLog(pool, {
        actorUserId: req.userId!,
        action: "ADMIN_NOTIFICATION_TEMPLATE_DELETE",
        entityType: "notification_template",
        entityId: String(templateId),
        metadata: {},
      });
      res.json({ ok: true });
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
        metadata: body,
      });
      res.json({ ok: true });
    },

    // --- Transactions & Ledger ---
    adminListTransactions: async (req: AuthedRequest, res: Response) => {
      const payerUserId = typeof req.query.payerUserId === "string" ? BigInt(req.query.payerUserId) : undefined;
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      const payments = await paymentRepo.listPayments(pool, { payerUserId, status });
      res.json({ payments });
    },

    adminGetTransaction: async (req: AuthedRequest, res: Response) => {
      const paymentId = pid(req.params.id);
      const payment = await paymentRepo.findPaymentById(pool, paymentId);
      if (!payment) throw new HttpError(404, "Payment not found");
      res.json({ payment });
    },
  };
}

