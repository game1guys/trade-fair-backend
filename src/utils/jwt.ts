import jwt, { type SignOptions } from "jsonwebtoken";
import { env } from "../config/env.js";

export type AccessPayload = {
  sub: string;
  email: string;
};

export function signAccessToken(payload: AccessPayload): string {
  const options: SignOptions = {
    expiresIn: env.jwt.accessExpires as SignOptions["expiresIn"],
    issuer: "tradefair-api",
  };
  return jwt.sign(payload, env.jwt.accessSecret, options);
}

export function verifyAccessToken(token: string): AccessPayload {
  const decoded = jwt.verify(token, env.jwt.accessSecret, {
    issuer: "tradefair-api",
  });
  if (typeof decoded !== "object" || decoded === null) {
    throw new Error("Invalid token payload");
  }
  const sub = (decoded as { sub?: string }).sub;
  const email = (decoded as { email?: string }).email;
  if (!sub || !email) throw new Error("Invalid token claims");
  return { sub, email };
}

export type RefreshPayload = {
  sub: string;
  email: string;
  jti: string;
  typ: "refresh";
};

export function signRefreshToken(payload: { sub: string; email: string; jti: string }): string {
  const options: SignOptions = {
    expiresIn: env.jwt.refreshExpires as SignOptions["expiresIn"],
    issuer: "tradefair-api",
  };
  const body = { ...payload, typ: "refresh" as const };
  return jwt.sign(body, env.jwt.refreshSecret, options);
}

export function verifyRefreshToken(token: string): RefreshPayload {
  const decoded = jwt.verify(token, env.jwt.refreshSecret, {
    issuer: "tradefair-api",
  });
  if (typeof decoded !== "object" || decoded === null) {
    throw new Error("Invalid refresh token payload");
  }
  const o = decoded as { sub?: string; email?: string; jti?: string; typ?: string };
  if (o.typ !== "refresh" || !o.sub || !o.email || !o.jti) {
    throw new Error("Invalid refresh token claims");
  }
  return { sub: o.sub, email: o.email, jti: o.jti, typ: "refresh" };
}
