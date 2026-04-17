import type { Pool } from "mysql2/promise";
import type { Response } from "express";
import * as auditRepo from "../repositories/auditRepository.js";
import * as kycRepo from "../repositories/kycRepository.js";
import * as supportRepo from "../repositories/supportRepository.js";
import * as userRepo from "../repositories/userRepository.js";
import * as notifRepo from "../repositories/notificationRepository.js";
import * as disputeRepo from "../repositories/disputeRepository.js";
import { HttpError } from "../utils/httpError.js";
import type { AuthedRequest } from "../middlewares/authMiddleware.js";
import { disputeCreateSchema, kycSubmitSchema, supportCreateSchema } from "../validators/phase2Schemas.js";

export function createPhase2UserController(pool: Pool) {
  return {
    submitKyc: async (req: AuthedRequest, res: Response) => {
      const body = kycSubmitSchema.parse(req.body);
      const roles = await userRepo.getRoleCodesForUser(pool, req.userId!);
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
        subject: body.subject,
        body: body.body,
        priority: body.priority,
      });
      await auditRepo.insertAuditLog(pool, {
        actorUserId: req.userId!,
        action: "SUPPORT_TICKET_CREATE",
        entityType: "support_ticket",
        entityId: String(id),
        metadata: { priority: body.priority },
      });
      res.status(201).json({ id: String(id) });
    },

    listMySupportTickets: async (req: AuthedRequest, res: Response) => {
      const items = await supportRepo.listMySupportTickets(pool, req.userId!);
      res.json({ tickets: items });
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

