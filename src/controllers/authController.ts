import type { Response } from "express";
import type { Pool } from "mysql2/promise";
import type { AuthedRequest } from "../middlewares/authMiddleware.js";
import * as authService from "../services/authService.js";
import {
  loginSchema,
  logoutSchema,
  phoneOtpRequestSchema,
  phoneOtpVerifySchema,
  refreshSchema,
  signupSchema,
} from "../validators/authSchemas.js";

export function createAuthController(pool: Pool) {
  return {
    signup: async (req: AuthedRequest, res: Response) => {
      const body = signupSchema.parse(req.body);
      const result = await authService.signup(pool, body);
      return res.status(201).json(result);
    },

    login: async (req: AuthedRequest, res: Response) => {
      const body = loginSchema.parse(req.body);
      const result = await authService.login(pool, body);
      return res.json(result);
    },

    refresh: async (req: AuthedRequest, res: Response) => {
      const body = refreshSchema.parse(req.body);
      const tokens = await authService.refreshSession(pool, body.refreshToken);
      return res.json(tokens);
    },

    logout: async (req: AuthedRequest, res: Response) => {
      const body = logoutSchema.parse(req.body);
      await authService.logout(pool, body.refreshToken);
      return res.status(204).send();
    },

    me: async (req: AuthedRequest, res: Response) => {
      if (!req.userId) return res.status(401).json({ error: "Unauthorized" });
      const me = await authService.getMe(pool, req.userId);
      return res.json(me);
    },

    /** Stub OTP — Phase 1 MVP (no SMS provider). */
    phoneRequestOtp: async (req: AuthedRequest, res: Response) => {
      phoneOtpRequestSchema.parse(req.body);
      return res.json({
        ok: true,
        message: "Stub mode: use OTP 123456",
        stubOtp: "123456",
      });
    },

    phoneVerifyOtp: async (req: AuthedRequest, res: Response) => {
      const body = phoneOtpVerifySchema.parse(req.body);
      if (body.otp !== "123456") {
        return res.status(400).json({ error: "Invalid OTP (stub: use 123456)" });
      }
      return res.json({ ok: true, verified: true, phone: body.phone });
    },
  };
}
