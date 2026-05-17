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

/** Only organizers submit KYC documents (exhibitors and service providers do not). */
const KYC_ROLE = "ORGANIZER";

/** Organizer uploads must use one of these `docType` values (see organizer KYC UI). */
const ORGANIZER_KYC_DOC_TYPES = new Set(["organizer_business_proof", "aadhaar_card", "organizer_genuineness"]);

function kycRoleAutoApproves(roleCode: string): boolean {
  return roleCode.trim().toUpperCase() === KYC_ROLE;
}

export function createPhase2UserController(pool: Pool) {
  return {
    submitKyc: async (req: AuthedRequest, res: Response) => {
      const body = kycSubmitSchema.parse(req.body);
      const rc = body.roleCode.trim().toUpperCase();
      if (rc !== KYC_ROLE) throw new HttpError(400, "KYC is only available for organizers.");
      const roles = await userRepo.getRoleCodesForUser(pool, req.userId!);
      if (!roles.includes(KYC_ROLE)) throw new HttpError(403, "You need the organizer role to submit KYC.");
      const id = await kycRepo.insertKycDocument(pool, {
        userId: req.userId!,
        roleCode: KYC_ROLE,
        docType: body.docType,
        docUrl: body.docUrl,
        meta: (body.meta as Record<string, unknown> | null) ?? null,
      });
      if (env.autoApproveKycOnUpload && kycRoleAutoApproves(KYC_ROLE)) {
        await kycRepo.markKycDocumentAutoApproved(pool, id, `auto-approved (${env.nodeEnv})`);
      }
      await auditRepo.insertAuditLog(pool, {
        actorUserId: req.userId!,
        action: "KYC_SUBMIT",
        entityType: "kyc_document",
        entityId: String(id),
        metadata: { roleCode: KYC_ROLE, docType: body.docType },
      });
      res.status(201).json({ id: String(id) });
    },

    /** Multipart field name: `file`. Body: `roleCode` must be ORGANIZER; `docType` defaults to organizer_business_proof. */
    uploadKycDocument: async (req: AuthedRequest, res: Response) => {
      const file = (req as AuthedRequest & { file?: { filename: string; originalname: string; mimetype: string } }).file;
      if (!file) throw new HttpError(400, 'Missing file (multipart field name "file")');

      const roleCodeRaw = (typeof req.body?.roleCode === "string" ? req.body.roleCode.trim().toUpperCase() : "") || KYC_ROLE;
      if (roleCodeRaw !== KYC_ROLE) throw new HttpError(400, "KYC uploads are only for organizers.");

      const roles = await userRepo.getRoleCodesForUser(pool, req.userId!);
      if (!roles.includes(KYC_ROLE)) throw new HttpError(403, "You need the organizer role to upload KYC.");

      const defaultDocType = "organizer_business_proof";
      const docTypeRaw =
        typeof req.body?.docType === "string" && req.body.docType.trim().length >= 2
          ? req.body.docType.trim().slice(0, 64)
          : "";
      const docType = docTypeRaw || defaultDocType;

      if (!ORGANIZER_KYC_DOC_TYPES.has(docType)) {
        throw new HttpError(
          400,
          "Invalid docType for organizer. Use organizer_business_proof, aadhaar_card, or organizer_genuineness."
        );
      }

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
      if (env.autoApproveKycOnUpload && kycRoleAutoApproves(roleCodeRaw)) {
        await kycRepo.markKycDocumentAutoApproved(pool, id, `auto-approved (${env.nodeEnv})`);
      }
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
      const q = typeof req.query.roleCode === "string" ? req.query.roleCode.trim().toUpperCase() : "";
      if (q && q !== KYC_ROLE) {
        res.json({ kyc: [] });
        return;
      }
      const items = await kycRepo.listMyKyc(pool, req.userId!, { roleCode: KYC_ROLE });
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
      const ticketId = BigInt(String(req.params.id));
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
      const ticketId = BigInt(String(req.params.id));
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

      const ticketId = BigInt(String(req.params.id));
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

