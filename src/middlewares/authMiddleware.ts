import type { Request, Response, NextFunction } from "express";
import { verifyAccessToken } from "../utils/jwt.js";

export type AuthedRequest = Request & {
  userId?: bigint;
  userEmail?: string;
  permissionCodes?: string[];
};

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing bearer token" });
  }
  const token = header.slice("Bearer ".length).trim();
  try {
    const payload = verifyAccessToken(token);
    req.userId = BigInt(payload.sub);
    req.userEmail = payload.email;
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}
