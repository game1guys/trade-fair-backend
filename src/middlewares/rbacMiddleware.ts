import type { NextFunction, Response } from "express";
import type { Pool } from "mysql2/promise";
import { getPermissionCodesForUser } from "../repositories/permissionRepository.js";
import { listScopesForSubAdmin } from "../repositories/subAdminScopeRepository.js";
import { assignRoleByCode, getRoleCodesForUser } from "../repositories/userRepository.js";
import type { AuthedRequest } from "./authMiddleware.js";

/** User must have at least one of the given role codes (e.g. ORGANIZER). */
export function requireAnyRole(pool: Pool, ...allowedRoles: string[]) {
  return async (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const roles = await getRoleCodesForUser(pool, req.userId);
    if (!allowedRoles.some((r) => roles.includes(r))) {
      return res.status(403).json({
        error: "Forbidden",
        message: `This action requires role: ${allowedRoles.join(" or ")}. Your roles: ${roles.length ? roles.join(", ") : "none"}. Ask an admin to assign the role or use an account that already has it.`,
      });
    }
    return next();
  };
}

/**
 * Ensures the user has a role by auto-assigning it if missing.
 * Use for onboarding flows where role assignment should not block the UI.
 */
export function ensureRole(pool: Pool, roleCode: string) {
  return async (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.userId) return res.status(401).json({ error: "Unauthorized" });
    const roles = await getRoleCodesForUser(pool, req.userId);
    if (!roles.includes(roleCode)) {
      await assignRoleByCode(pool, req.userId, roleCode);
    }
    return next();
  };
}

/** Legacy no-op: verification is only via KYC (`kyc_documents`), not `users.pending_admin_review`. */
export function denyPendingAdminReview(_pool: Pool) {
  return async (_req: AuthedRequest, _res: Response, next: NextFunction) => {
    next();
  };
}

export function requirePermission(pool: Pool, ...required: string[]) {
  return async (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const codes = await getPermissionCodesForUser(pool, req.userId);
    req.permissionCodes = codes;
    const ok = required.every((c) => codes.includes(c));
    if (!ok) {
      return res.status(403).json({ error: "Forbidden" });
    }
    return next();
  };
}

/** Super admin always allowed. Sub-admin must have the given scope_code. */
export function requireSubAdminScope(pool: Pool, scopeCode: string) {
  return async (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.userId) return res.status(401).json({ error: "Unauthorized" });
    const roles = await getRoleCodesForUser(pool, req.userId);
    if (roles.includes("SUPER_ADMIN")) return next();
    if (!roles.includes("SUB_ADMIN")) return res.status(403).json({ error: "Forbidden" });
    const scopes = await listScopesForSubAdmin(pool, req.userId);
    if (!scopes.includes(scopeCode)) return res.status(403).json({ error: "Forbidden" });
    return next();
  };
}
