import type { NextFunction, Response } from "express";
import type { Pool } from "mysql2/promise";
import { getPermissionCodesForUser } from "../repositories/permissionRepository.js";
import { listScopesForSubAdmin } from "../repositories/subAdminScopeRepository.js";
import { getRoleCodesForUser } from "../repositories/userRepository.js";
import type { AuthedRequest } from "./authMiddleware.js";

/** User must have at least one of the given role codes (e.g. ORGANIZER). */
export function requireAnyRole(pool: Pool, ...allowedRoles: string[]) {
  return async (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const roles = await getRoleCodesForUser(pool, req.userId);
    if (!allowedRoles.some((r) => roles.includes(r))) {
      return res.status(403).json({ error: "Forbidden" });
    }
    return next();
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
