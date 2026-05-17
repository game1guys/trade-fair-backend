import { z } from "zod";

export const createVolunteerSchema = z.object({
  fullName: z.string().trim().min(1).max(255),
  phone: z.string().trim().min(6).max(32),
  email: z.string().trim().email().max(255),
  password: z.string().min(8).max(128),
});

export const assignVolunteerSchema = z.object({
  volunteerId: z.string().regex(/^\d+$/),
});
