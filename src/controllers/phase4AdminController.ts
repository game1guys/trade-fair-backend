import type { Pool } from "mysql2/promise";
import type { Response } from "express";
import * as auditRepo from "../repositories/auditRepository.js";
import * as marketplaceRepo from "../repositories/marketplaceRepository.js";
import * as paymentRepo from "../repositories/paymentRepository.js";
import * as phase4Repo from "../repositories/phase4AdminRepository.js";
import * as rolePermRepo from "../repositories/rolePermissionRepository.js";
import type { AuthedRequest } from "../middlewares/authMiddleware.js";
import { HttpError } from "../utils/httpError.js";
import {
  adminRefundCreateSchema,
  analyticsQuerySchema,
  featuredUpsertSchema,
  flagPatchSchema,
  flagsQuerySchema,
  ledgerQuerySchema,
  rolePermissionsPutSchema,
  rbacMatrixPutSchema,
} from "../validators/phase4Schemas.js";

function pid(v: string | string[] | undefined): bigint {
  const s = Array.isArray(v) ? v[0] : v;
  if (!s) throw new HttpError(400, "Missing id");
  return BigInt(s);
}

function parseOptionalDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function createPhase4AdminController(pool: Pool) {
  return {
    analyticsSummary: async (req: AuthedRequest, res: Response) => {
      analyticsQuerySchema.parse({ days: typeof req.query.days === "string" ? req.query.days : undefined });
      const summary = await phase4Repo.adminAnalyticsSummary(pool);
      res.json({ summary });
    },

    analyticsUserGrowth: async (req: AuthedRequest, res: Response) => {
      const q = analyticsQuerySchema.parse({ days: typeof req.query.days === "string" ? req.query.days : undefined });
      const days = q.days ? Number(q.days) : 30;
      const series = await phase4Repo.adminUsersGrowthSeries(pool, days);
      res.json({ series });
    },

    transactionsLedger: async (req: AuthedRequest, res: Response) => {
      const q = ledgerQuerySchema.parse({ limit: typeof req.query.limit === "string" ? req.query.limit : undefined });
      const limit = q.limit ? Number(q.limit) : 200;
      const rows = await phase4Repo.adminTransactionLedger(pool, limit);
      res.json({ ledger: rows });
    },

    exportLedgerCsv: async (req: AuthedRequest, res: Response) => {
      const q = ledgerQuerySchema.parse({ limit: typeof req.query.limit === "string" ? req.query.limit : undefined });
      const limit = q.limit ? Number(q.limit) : 500;
      const rows = await phase4Repo.adminTransactionLedger(pool, limit);
      const csv = phase4Repo.ledgerCsv(rows);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename=\"ledger_${new Date().toISOString().slice(0, 10)}.csv\"`);
      res.status(200).send(csv);
    },

    moderationListFlags: async (req: AuthedRequest, res: Response) => {
      const q = flagsQuerySchema.parse({ status: typeof req.query.status === "string" ? req.query.status : undefined });
      const items = await phase4Repo.adminListFlags(pool, q.status);
      res.json({ flags: items });
    },

    moderationPatchFlag: async (req: AuthedRequest, res: Response) => {
      const flagId = pid(req.params.flagId);
      const body = flagPatchSchema.parse(req.body);
      const ok = await phase4Repo.adminPatchFlag(pool, flagId, body.status);
      if (!ok) throw new HttpError(404, "Flag not found");
      await auditRepo.insertAuditLog(pool, {
        actorUserId: req.userId!,
        action: "ADMIN_FLAG_PATCH",
        entityType: "content_flag",
        entityId: String(flagId),
        metadata: { status: body.status },
      });
      res.json({ ok: true });
    },

    featuredList: async (_req: AuthedRequest, res: Response) => {
      const items = await phase4Repo.adminListFeatured(pool);
      res.json({ featured: items });
    },

    featuredUpsert: async (req: AuthedRequest, res: Response) => {
      const body = featuredUpsertSchema.parse(req.body);
      await phase4Repo.adminUpsertFeatured(pool, {
        entityType: body.entityType,
        entityId: body.entityId,
        label: body.label ?? null,
        startsAt: parseOptionalDate(body.startsAt),
        endsAt: parseOptionalDate(body.endsAt),
        active: body.active ?? true,
        createdByUserId: req.userId!,
      });
      await auditRepo.insertAuditLog(pool, {
        actorUserId: req.userId!,
        action: "ADMIN_FEATURED_UPSERT",
        entityType: "featured_listing",
        entityId: `${body.entityType}:${body.entityId}`,
        metadata: { active: body.active ?? true },
      });
      res.json({ ok: true });
    },

    featuredDelete: async (req: AuthedRequest, res: Response) => {
      const id = pid(req.params.featureId);
      const ok = await phase4Repo.adminDeleteFeaturedById(pool, id);
      if (!ok) throw new HttpError(404, "Featured item not found");
      await auditRepo.insertAuditLog(pool, {
        actorUserId: req.userId!,
        action: "ADMIN_FEATURED_DELETE",
        entityType: "featured_listing",
        entityId: String(id),
        metadata: {},
      });
      res.json({ ok: true });
    },

    adminCatalogDrafts: async (_req: AuthedRequest, res: Response) => {
      const [draftEvents, draftServices] = await Promise.all([
        phase4Repo.adminListDraftEventsForCatalog(pool),
        phase4Repo.adminListDraftServicesForCatalog(pool),
      ]);
      res.json({ draftEvents, draftServices });
    },

    adminPublishCatalogEvent: async (req: AuthedRequest, res: Response) => {
      const eventId = pid(req.params.eventId);
      const ok = await phase4Repo.adminPublishDraftEvent(pool, eventId);
      if (!ok) throw new HttpError(404, "Draft event not found");
      await auditRepo.insertAuditLog(pool, {
        actorUserId: req.userId!,
        action: "ADMIN_CATALOG_PUBLISH_EVENT",
        entityType: "event",
        entityId: String(eventId),
        metadata: {},
      });
      res.json({ ok: true });
    },

    adminPublishCatalogService: async (req: AuthedRequest, res: Response) => {
      const serviceId = pid(req.params.serviceId);
      const ok = await phase4Repo.adminPublishDraftService(pool, serviceId);
      if (!ok) throw new HttpError(404, "Draft service not found");
      await auditRepo.insertAuditLog(pool, {
        actorUserId: req.userId!,
        action: "ADMIN_CATALOG_PUBLISH_SERVICE",
        entityType: "service",
        entityId: String(serviceId),
        metadata: {},
      });
      res.json({ ok: true });
    },

    // --- Plan-compat admin APIs ---
    adminListRoles: async (_req: AuthedRequest, res: Response) => {
      const roles = await rolePermRepo.listRoles(pool);
      res.json({ roles });
    },

    adminListPermissions: async (_req: AuthedRequest, res: Response) => {
      const permissions = await rolePermRepo.listPermissionCodes(pool);
      res.json({ permissions });
    },

    adminGetRolePermissions: async (req: AuthedRequest, res: Response) => {
      const roleId = Number(String(req.params.roleId ?? ""));
      if (!Number.isFinite(roleId) || roleId <= 0) throw new HttpError(400, "Invalid roleId");
      const role = await rolePermRepo.getRoleById(pool, roleId);
      if (!role) throw new HttpError(404, "Role not found");
      const permissionCodes = await rolePermRepo.listRolePermissionCodes(pool, roleId);
      res.json({ roleId, roleCode: String(role.code), permissionCodes });
    },

    adminPutRolePermissions: async (req: AuthedRequest, res: Response) => {
      const roleId = Number(String(req.params.roleId ?? ""));
      if (!Number.isFinite(roleId) || roleId <= 0) throw new HttpError(400, "Invalid roleId");
      const body = rolePermissionsPutSchema.parse(req.body);
      const ok = await rolePermRepo.replaceRolePermissionsByCodes(pool, roleId, body.permissionCodes);
      if (!ok) throw new HttpError(404, "Role not found");
      await auditRepo.insertAuditLog(pool, {
        actorUserId: req.userId!,
        action: "ADMIN_ROLE_PERMISSIONS_PUT",
        entityType: "role",
        entityId: String(roleId),
        metadata: { count: body.permissionCodes.length },
      });
      const codes = await rolePermRepo.listRolePermissionCodes(pool, roleId);
      res.json({ ok: true, roleId, permissionCodes: codes });
    },

    adminRbacMatrixGet: async (_req: AuthedRequest, res: Response) => {
      const data = await rolePermRepo.getRbacPermissionMatrix(pool);
      res.json(data);
    },

    adminRbacMatrixPut: async (req: AuthedRequest, res: Response) => {
      const body = rbacMatrixPutSchema.parse(req.body);
      const r = await rolePermRepo.putRbacMatrixFromPayload(pool, body.roles);
      if (r.failedRoleId != null) throw new HttpError(404, `Role not found: ${r.failedRoleId}`);
      await auditRepo.insertAuditLog(pool, {
        actorUserId: req.userId!,
        action: "ADMIN_RBAC_MATRIX_PUT",
        entityType: "rbac",
        entityId: "matrix",
        metadata: { roleCount: Object.keys(body.roles).length },
      });
      res.json({ ok: true });
    },

    adminCreateRefundForPayment: async (req: AuthedRequest, res: Response) => {
      const paymentId = pid(req.params.paymentId);
      const body = adminRefundCreateSchema.parse(req.body ?? {});
      const pay = await paymentRepo.findPaymentById(pool, paymentId);
      if (!pay) throw new HttpError(404, "Payment not found");
      const maxAmt = BigInt(String(pay.amount_minor));
      const amt = body.amountMinor != null ? BigInt(body.amountMinor) : maxAmt;
      if (amt <= 0n || amt > maxAmt) throw new HttpError(400, "Invalid refund amount");
      const refundId = await marketplaceRepo.insertRefundRecord(pool, {
        paymentId,
        amountMinor: amt,
        requestedByUserId: req.userId!,
        notes: body.notes ?? null,
      });
      await auditRepo.insertAuditLog(pool, {
        actorUserId: req.userId!,
        action: "ADMIN_REFUND_REQUEST_CREATE",
        entityType: "refund",
        entityId: String(refundId),
        metadata: { paymentId: String(paymentId), amountMinor: String(amt) },
      });
      res.status(201).json({ refundId: String(refundId) });
    },
  };
}

