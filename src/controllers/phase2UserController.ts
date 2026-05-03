import type { Pool } from "mysql2/promise";
import type { Response } from "express";
import * as auditRepo from "../repositories/auditRepository.js";
import * as kycRepo from "../repositories/kycRepository.js";
import * as supportRepo from "../repositories/supportRepository.js";
import * as userRepo from "../repositories/userRepository.js";
import * as notifRepo from "../repositories/notificationRepository.js";
import * as disputeRepo from "../repositories/disputeRepository.js";
import { env } from "../config/env.js";
import { HttpError } from "../utils/httpError.js";
import type { AuthedRequest } from "../middlewares/authMiddleware.js";
import { disputeCreateSchema, kycSubmitSchema, supportAttachmentCreateSchema, supportCreateSchema, supportResponseCreateSchema } from "../validators/phase2Schemas.js";

const KYC_UPLOAD_ROLES = new Set(["EXHIBITOR", "ORGANIZER", "SERVICE_PROVIDER"]);

async function ensureRoleForKyc(pool: Pool, userId: bigint, roleCode: string): Promise<string[]> {
  let roles = await userRepo.getRoleCodesForUser(pool, userId);
  if (roleCode === "EXHIBITOR" && !roles.includes("EXHIBITOR")) {
    await userRepo.assignRoleByCode(pool, userId, "EXHIBITOR");
    roles = await userRepo.getRoleCodesForUser(pool, userId);
  }
  return roles;
}

export function createPhase2UserController(pool: Pool) {
  return {
    submitKyc: async (req: AuthedRequest, res: Response) => {
      const body = kycSubmitSchema.parse(req.body);
      const roles = await ensureRoleForKyc(pool, req.userId!, body.roleCode);
      if (!roles.includes(body.roleCode)) throw new HttpError(400, "Role mismatch for KYC submit");
      if (body.roleCode === "VISITOR") throw new HttpError(400, "Visitors do not submit KYC in Phase 2");
      const id = await kycRepo.insertKycDocument(pool, {
        userId: req.userId!,
        roleCode: body.roleCode,
        docType: body.docType,
        docUrl: body.docUrl,
        meta: (body.meta as Record<string, unknown> | null) ?? null,
      });
      await auditRepo.insertAuditLog(pool, {
        actorUserId: req.userId!,
        action: "KYC_SUBMIT",
        entityType: "kyc_document",
        entityId: String(id),
        metadata: { roleCode: body.roleCode, docType: body.docType },
      });
      res.status(201).json({ id: String(id) });
    },

    /** Multipart field name: `file`. Optional body: `roleCode` (default EXHIBITOR), `docType` (default gst_certificate). */
    uploadKycDocument: async (req: AuthedRequest, res: Response) => {
      const file = (req as AuthedRequest & { file?: { filename: string; originalname: string; mimetype: string } }).file;
      if (!file) throw new HttpError(400, 'Missing file (multipart field name "file")');

      const roleCodeRaw = typeof req.body?.roleCode === "string" ? req.body.roleCode.trim() : "EXHIBITOR";
      if (!KYC_UPLOAD_ROLES.has(roleCodeRaw)) throw new HttpError(400, "Invalid roleCode for KYC upload");

      const roles = await ensureRoleForKyc(pool, req.userId!, roleCodeRaw);
      if (!roles.includes(roleCodeRaw)) throw new HttpError(400, "Role mismatch for KYC upload");

      const docType =
        typeof req.body?.docType === "string" && req.body.docType.trim().length >= 2
          ? req.body.docType.trim().slice(0, 64)
          : "gst_certificate";

      const relativePath = `kyc/${req.userId}/${file.filename}`;
      const prefix = env.apiPrefix.startsWith("/") ? env.apiPrefix : `/${env.apiPrefix}`;
      const docUrl = `${prefix}/static/uploads/${relativePath}`;

      const id = await kycRepo.insertKycDocument(pool, {
        userId: req.userId!,
        roleCode: roleCodeRaw,
        docType,
        docUrl,
        meta: { originalFilename: file.originalname, mimeType: file.mimetype },
      });
      await auditRepo.insertAuditLog(pool, {
        actorUserId: req.userId!,
        action: "KYC_SUBMIT",
        entityType: "kyc_document",
        entityId: String(id),
        metadata: { roleCode: roleCodeRaw, docType, upload: true },
      });
      res.status(201).json({ id: String(id), docUrl });
    },

    listMyKyc: async (req: AuthedRequest, res: Response) => {
      const items = await kycRepo.listMyKyc(pool, req.userId!);
      res.json({ kyc: items });
    },

    createSupportTicket: async (req: AuthedRequest, res: Response) => {
      const body = supportCreateSchema.parse(req.body);
      const roles = await userRepo.getRoleCodesForUser(pool, req.userId!);
      const roleCode = roles.includes("ORGANIZER")
        ? "ORGANIZER"
        : roles.includes("EXHIBITOR")
          ? "EXHIBITOR"
          : roles.includes("SERVICE_PROVIDER")
            ? "SERVICE_PROVIDER"
            : "VISITOR";

      const id = await supportRepo.createSupportTicket(pool, {
        createdByUserId: req.userId!,
        roleCode,
        category: body.category,
        subject: body.subject,
        body: body.body,
        priority: body.priority,
        disputeId: body.disputeId ? BigInt(body.disputeId) : null,
      });
      await auditRepo.insertAuditLog(pool, {
        actorUserId: req.userId!,
        action: "SUPPORT_TICKET_CREATE",
        entityType: "support_ticket",
        entityId: String(id),
        metadata: { category: body.category, priority: body.priority },
      });
      res.status(201).json({ id: String(id) });
    },

    listMySupportTickets: async (req: AuthedRequest, res: Response) => {
      const tickets = await supportRepo.listMySupportTickets(pool, req.userId!);
      res.json({ tickets });
    },

    getSupportTicketDetails: async (req: AuthedRequest, res: Response) => {
      const ticketId = BigInt(req.params.id);
      // Basic check: is this the owner? (Staff can also access via admin panel)
      const [rows] = await pool.query<import("mysql2").RowDataPacket[]>(
        "SELECT created_by_user_id FROM support_tickets WHERE id = ?",
        [ticketId]
      );
      if (!rows.length) throw new HttpError(404, "Ticket not found");
      if (BigInt(rows[0].created_by_user_id as string) !== req.userId!) throw new HttpError(403, "Forbidden");

      const responses = await supportRepo.listTicketResponses(pool, ticketId);
      const attachments = await supportRepo.listTicketAttachments(pool, ticketId);
      res.json({ responses, attachments });
    },

    addSupportResponse: async (req: AuthedRequest, res: Response) => {
      const ticketId = BigInt(req.params.id);
      const body = supportResponseCreateSchema.parse(req.body);

      // Check owner
      const [rows] = await pool.query<import("mysql2").RowDataPacket[]>(
        "SELECT created_by_user_id, status FROM support_tickets WHERE id = ?",
        [ticketId]
      );
      if (!rows.length) throw new HttpError(404, "Ticket not found");
      if (BigInt(rows[0].created_by_user_id as string) !== req.userId!) throw new HttpError(403, "Forbidden");
      if (rows[0].status === "closed") throw new HttpError(400, "Cannot reply to closed ticket");

      const id = await supportRepo.addTicketResponse(pool, {
        ticketId,
        userId: req.userId!,
        body: body.body,
        isStaffResponse: false,
      });
      res.status(201).json({ id: String(id) });
    },

    uploadSupportAttachment: async (req: AuthedRequest, res: Response) => {
      const file = (req as AuthedRequest & { file?: { filename: string; originalname: string; mimetype: string; size: number } }).file;
      if (!file) throw new HttpError(400, 'Missing file (multipart field name "file")');

      const ticketId = BigInt(req.params.id);
      const responseId = req.body.responseId ? BigInt(req.body.responseId) : null;

      // Check owner
      const [rows] = await pool.query<import("mysql2").RowDataPacket[]>(
        "SELECT created_by_user_id FROM support_tickets WHERE id = ?",
        [ticketId]
      );
      if (!rows.length) throw new HttpError(404, "Ticket not found");
      if (BigInt(rows[0].created_by_user_id as string) !== req.userId!) throw new HttpError(403, "Forbidden");

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

    // --- Disputes (Phase 2 stub) ---
    createDispute: async (req: AuthedRequest, res: Response) => {
      const body = disputeCreateSchema.parse(req.body);
      const paymentId = body.paymentId ? BigInt(body.paymentId) : null;
      const id = await disputeRepo.createDispute(pool, { paymentId });
      await auditRepo.insertAuditLog(pool, {
        actorUserId: req.userId!,
        action: "DISPUTE_CREATE",
        entityType: "dispute",
        entityId: String(id),
        metadata: { paymentId: body.paymentId ?? null },
      });
      res.status(201).json({ id: String(id) });
    },

    // --- Notifications inbox (Phase 2) ---
    listMyNotifications: async (req: AuthedRequest, res: Response) => {
      const items = await notifRepo.listMyNotifications(pool, req.userId!);
      res.json({ notifications: items });
    },
  };
}

