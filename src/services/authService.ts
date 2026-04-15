import bcrypt from "bcryptjs";
import type { Pool } from "mysql2/promise";
import { env } from "../config/env.js";
import * as auditRepo from "../repositories/auditRepository.js";
import * as refreshRepo from "../repositories/refreshTokenRepository.js";
import * as userRepo from "../repositories/userRepository.js";
import * as permissionRepo from "../repositories/permissionRepository.js";
import { sha256Hex } from "../utils/crypto.js";
import { newJti } from "../utils/ids.js";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../utils/jwt.js";
import { HttpError } from "../utils/httpError.js";

const SALT_ROUNDS = 12;

function parseRefreshExpiryMs(): number {
  const s = env.jwt.refreshExpires;
  const m = /^(\d+)([dhms])$/.exec(s.trim());
  if (!m) return 7 * 24 * 60 * 60 * 1000;
  const n = Number(m[1]);
  const u = m[2];
  const mult: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return n * (mult[u] ?? 86_400_000);
}

export async function signup(
  pool: Pool,
  input: { email: string; password: string; fullName: string; phone?: string | null }
) {
  const existing = await userRepo.findUserByEmail(pool, input.email);
  if (existing) throw new HttpError(409, "Email already registered");

  const passwordHash = await bcrypt.hash(input.password, SALT_ROUNDS);
  const userId = await userRepo.insertUser(pool, {
    email: input.email,
    passwordHash,
    fullName: input.fullName,
    phone: input.phone,
  });
  await userRepo.assignRoleByCode(pool, userId, "VISITOR");

  const tokens = await issueTokens(pool, userId, input.email.toLowerCase());

  await auditRepo.insertAuditLog(pool, {
    actorUserId: userId,
    action: "AUTH_SIGNUP",
    entityType: "user",
    entityId: String(userId),
    metadata: { email: input.email.toLowerCase() },
  });

  return {
    ...tokens,
    user: {
      id: String(userId),
      email: input.email.toLowerCase(),
      fullName: input.fullName,
      roles: ["VISITOR"],
    },
  };
}

export async function login(pool: Pool, input: { email: string; password: string }) {
  const user = await userRepo.findUserByEmail(pool, input.email);
  if (!user) {
    await auditRepo.insertAuditLog(pool, {
      actorUserId: null,
      action: "AUTH_LOGIN_FAILED",
      entityType: "user",
      entityId: null,
      metadata: { email: input.email.toLowerCase(), reason: "unknown_user" },
    });
    throw new HttpError(401, "Invalid credentials");
  }
  if (user.status !== "active") {
    await auditRepo.insertAuditLog(pool, {
      actorUserId: user.id,
      action: "AUTH_LOGIN_FAILED",
      entityType: "user",
      entityId: String(user.id),
      metadata: { reason: "inactive" },
    });
    throw new HttpError(403, "Account is not active");
  }

  const ok = await bcrypt.compare(input.password, user.password_hash);
  if (!ok) {
    await auditRepo.insertAuditLog(pool, {
      actorUserId: user.id,
      action: "AUTH_LOGIN_FAILED",
      entityType: "user",
      entityId: String(user.id),
      metadata: { reason: "bad_password" },
    });
    throw new HttpError(401, "Invalid credentials");
  }

  const tokens = await issueTokens(pool, user.id, user.email);
  const roles = await userRepo.getRoleCodesForUser(pool, user.id);

  await auditRepo.insertAuditLog(pool, {
    actorUserId: user.id,
    action: "AUTH_LOGIN",
    entityType: "user",
    entityId: String(user.id),
    metadata: { email: user.email },
  });

  return {
    ...tokens,
    user: {
      id: String(user.id),
      email: user.email,
      fullName: user.full_name,
      roles,
    },
  };
}

async function issueTokens(pool: Pool, userId: bigint, email: string) {
  const accessToken = signAccessToken({ sub: String(userId), email });
  const jti = newJti();
  const refreshToken = signRefreshToken({ sub: String(userId), email, jti });
  const tokenHash = sha256Hex(refreshToken);
  const expiresAt = new Date(Date.now() + parseRefreshExpiryMs());

  await refreshRepo.insertRefreshToken(pool, { userId, jti, tokenHash, expiresAt });

  return {
    accessToken,
    refreshToken,
    expiresAt: expiresAt.toISOString(),
  };
}

export async function refreshSession(pool: Pool, rawRefresh: string) {
  let payload;
  try {
    payload = verifyRefreshToken(rawRefresh);
  } catch {
    throw new HttpError(401, "Invalid refresh token");
  }

  const row = await refreshRepo.findRefreshTokenByJti(pool, payload.jti);
  if (!row || row.revoked_at) throw new HttpError(401, "Invalid refresh token");
  if (row.expires_at.getTime() < Date.now()) throw new HttpError(401, "Refresh token expired");
  if (row.user_id !== BigInt(payload.sub)) throw new HttpError(401, "Invalid refresh token");

  const hash = sha256Hex(rawRefresh);
  if (row.token_hash !== hash) throw new HttpError(401, "Invalid refresh token");

  const user = await userRepo.findUserById(pool, row.user_id);
  if (!user || user.status !== "active") throw new HttpError(401, "Invalid session");

  await refreshRepo.revokeRefreshTokenByJti(pool, payload.jti);

  const tokens = await issueTokens(pool, user.id, user.email);

  await auditRepo.insertAuditLog(pool, {
    actorUserId: user.id,
    action: "AUTH_REFRESH",
    entityType: "session",
    entityId: payload.jti,
    metadata: { rotated: true },
  });

  return tokens;
}

export async function logout(pool: Pool, rawRefresh: string | undefined) {
  if (!rawRefresh) return;
  try {
    const payload = verifyRefreshToken(rawRefresh);
    await refreshRepo.revokeRefreshTokenByJti(pool, payload.jti);
    const uid = BigInt(payload.sub);
    await auditRepo.insertAuditLog(pool, {
      actorUserId: uid,
      action: "AUTH_LOGOUT",
      entityType: "session",
      entityId: payload.jti,
      metadata: {},
    });
  } catch {
    // ignore invalid token on logout
  }
}

export async function getMe(pool: Pool, userId: bigint) {
  const user = await userRepo.findUserById(pool, userId);
  if (!user) throw new HttpError(404, "User not found");
  const roles = await userRepo.getRoleCodesForUser(pool, userId);
  const permissions = await permissionRepo.getPermissionCodesForUser(pool, userId);
  return {
    id: String(user.id),
    email: user.email,
    fullName: user.full_name,
    phone: user.phone,
    status: user.status,
    roles,
    permissions,
  };
}

