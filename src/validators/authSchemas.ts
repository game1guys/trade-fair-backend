import { z } from "zod";

export const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  fullName: z.string().min(1).max(255),
  phone: z.string().max(32).optional().nullable(),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(128),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(10),
});

export const logoutSchema = z.object({
  refreshToken: z.string().min(10).optional(),
});

/** Phase 1 stub — no SMS; any request returns success; verify accepts fixed code `123456`. */
export const phoneOtpRequestSchema = z.object({
  phone: z.string().min(10).max(20),
});

export const phoneOtpVerifySchema = z.object({
  phone: z.string().min(10).max(20),
  otp: z.string().min(4).max(10),
});
