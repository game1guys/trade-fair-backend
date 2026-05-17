import type { Response } from "express";
import type { Pool } from "mysql2/promise";
import bcrypt from "bcryptjs";
import * as eventRepo from "../repositories/eventRepository.js";
import * as userRepo from "../repositories/userRepository.js";
import * as volunteerRepo from "../repositories/volunteerRepository.js";
import { processVisitorQrScan } from "../services/entryScanService.js";
import { assignVolunteerSchema, createVolunteerSchema } from "../validators/volunteerSchemas.js";
import { scanPayloadSchema } from "../validators/phase1Schemas.js";
import { HttpError } from "../utils/httpError.js";
import type { AuthedRequest } from "../middlewares/authMiddleware.js";
import { env } from "../config/env.js";
import {
  emailLater,
  emailVolunteerAssignedExisting,
  emailVolunteerNewWithCredentials,
  emailVolunteerPoolCreated,
} from "../services/transactionalEmail.js";

const SALT_ROUNDS = 12;

function pid(raw: string): bigint {
  if (!/^\d+$/.test(raw)) throw new HttpError(400, "Invalid id");
  return BigInt(raw);
}

function uploadPublicUrl(relativePath: string): string {
  const prefix = env.apiPrefix.startsWith("/") ? env.apiPrefix : `/${env.apiPrefix}`;
  return `${prefix}/static/uploads/${relativePath}`;
}

function serializeVolunteerRow(r: {
  id: unknown;
  full_name: unknown;
  phone: unknown;
  photo_url: unknown;
  user_id: unknown;
  login_email: unknown;
  created_at?: unknown;
  assignment_count?: unknown;
}) {
  return {
    id: String(r.id),
    fullName: String(r.full_name),
    phone: String(r.phone),
    photoUrl: r.photo_url != null ? String(r.photo_url) : null,
    userId: String(r.user_id),
    loginEmail: String(r.login_email),
    createdAt: r.created_at ?? null,
    assignmentCount: r.assignment_count != null ? Number(r.assignment_count) : undefined,
  };
}

export function createVolunteerController(pool: Pool) {
  return {
    organizerListVolunteers: async (req: AuthedRequest, res: Response) => {
      const rows = await volunteerRepo.listOrganizerVolunteers(pool, req.userId!);
      res.json({ volunteers: rows.map(serializeVolunteerRow) });
    },

    organizerCreateVolunteer: async (req: AuthedRequest, res: Response) => {
      const body = createVolunteerSchema.parse(req.body);
      const existing = await userRepo.findUserByEmail(pool, body.email);
      if (existing) throw new HttpError(409, "Email already registered — use another login email for this volunteer");

      const passwordHash = await bcrypt.hash(body.password, SALT_ROUNDS);
      const userId = await userRepo.insertUser(pool, {
        email: body.email,
        passwordHash,
        fullName: body.fullName,
        phone: body.phone,
      });
      await userRepo.assignRoleByCode(pool, userId, "VOLUNTEER");

      const volunteerId = await volunteerRepo.insertOrganizerVolunteer(pool, {
        organizerUserId: req.userId!,
        userId,
        fullName: body.fullName,
        phone: body.phone,
        photoUrl: null,
      });
      let photoUrl: string | null = null;
      const file = (req as AuthedRequest & { file?: { filename: string } }).file;
      if (file?.filename) {
        const relativePath = `volunteers/${req.userId}/${file.filename}`;
        photoUrl = uploadPublicUrl(relativePath);
        await volunteerRepo.updateVolunteerPhoto(pool, volunteerId, req.userId!, photoUrl);
      }

      emailLater(() =>
        emailVolunteerPoolCreated(pool, {
          volunteerUserId: userId,
          fullName: body.fullName,
          loginEmail: body.email.toLowerCase(),
          password: body.password,
        })
      );

      res.status(201).json({
        volunteer: {
          ...serializeVolunteerRow({
            id: volunteerId,
            full_name: body.fullName,
            phone: body.phone,
            photo_url: photoUrl,
            user_id: userId,
            login_email: body.email.toLowerCase(),
          }),
          loginEmail: body.email.toLowerCase(),
        },
      });
    },

    organizerListEventVolunteers: async (req: AuthedRequest, res: Response) => {
      const eventId = pid(req.params.eventId);
      const ev = await eventRepo.findEventById(pool, eventId);
      if (!ev || ev.organizer_user_id !== req.userId!) throw new HttpError(404, "Event not found");
      const rows = await volunteerRepo.listEventVolunteers(pool, eventId, req.userId!);
      res.json({
        volunteers: rows.map((r) => ({
          volunteerId: String(r.volunteer_id),
          assignmentId: String(r.assignment_id),
          fullName: String(r.full_name),
          phone: String(r.phone),
          photoUrl: r.photo_url != null ? String(r.photo_url) : null,
          loginEmail: String(r.login_email),
          assignedAt: r.assigned_at,
        })),
      });
    },

    organizerAssignVolunteer: async (req: AuthedRequest, res: Response) => {
      const eventId = pid(req.params.eventId);
      const body = assignVolunteerSchema.parse(req.body);
      const volunteerId = BigInt(body.volunteerId);
      const ev = await eventRepo.findEventById(pool, eventId);
      if (!ev || ev.organizer_user_id !== req.userId!) throw new HttpError(404, "Event not found");
      const vol = await volunteerRepo.findVolunteerForOrganizer(pool, volunteerId, req.userId!);
      if (!vol) throw new HttpError(404, "Volunteer not found in your team");
      await volunteerRepo.assignVolunteerToEvent(pool, eventId, volunteerId);
      emailLater(() =>
        emailVolunteerAssignedExisting(pool, {
          volunteerUserId: BigInt(String(vol.user_id)),
          fullName: String(vol.full_name),
          eventId,
        })
      );
      res.status(201).json({ ok: true });
    },

    organizerCreateAndAssignVolunteer: async (req: AuthedRequest, res: Response) => {
      const eventId = pid(req.params.eventId);
      const ev = await eventRepo.findEventById(pool, eventId);
      if (!ev || ev.organizer_user_id !== req.userId!) throw new HttpError(404, "Event not found");

      const body = createVolunteerSchema.parse(req.body);
      const existing = await userRepo.findUserByEmail(pool, body.email);
      if (existing) throw new HttpError(409, "Email already registered");

      const passwordHash = await bcrypt.hash(body.password, SALT_ROUNDS);
      const userId = await userRepo.insertUser(pool, {
        email: body.email,
        passwordHash,
        fullName: body.fullName,
        phone: body.phone,
      });
      await userRepo.assignRoleByCode(pool, userId, "VOLUNTEER");

      const volunteerId = await volunteerRepo.insertOrganizerVolunteer(pool, {
        organizerUserId: req.userId!,
        userId,
        fullName: body.fullName,
        phone: body.phone,
        photoUrl: null,
      });

      const file = (req as AuthedRequest & { file?: { filename: string } }).file;
      if (file?.filename) {
        const relativePath = `volunteers/${req.userId}/${file.filename}`;
        const photoUrl = uploadPublicUrl(relativePath);
        await volunteerRepo.updateVolunteerPhoto(pool, volunteerId, req.userId!, photoUrl);
      }

      await volunteerRepo.assignVolunteerToEvent(pool, eventId, volunteerId);
      emailLater(() =>
        emailVolunteerNewWithCredentials(pool, {
          volunteerUserId: userId,
          fullName: body.fullName,
          loginEmail: body.email.toLowerCase(),
          password: body.password,
          eventId,
        })
      );
      res.status(201).json({ ok: true, volunteerId: String(volunteerId) });
    },

    organizerUnassignVolunteer: async (req: AuthedRequest, res: Response) => {
      const eventId = pid(req.params.eventId);
      const volunteerId = pid(req.params.volunteerId);
      const ok = await volunteerRepo.unassignVolunteerFromEvent(pool, eventId, volunteerId, req.userId!);
      if (!ok) throw new HttpError(404, "Assignment not found");
      res.json({ ok: true });
    },

    volunteerListEvents: async (req: AuthedRequest, res: Response) => {
      const rows = await volunteerRepo.listVolunteerEventsForUser(pool, req.userId!);
      res.json({
        events: rows.map((r) => ({
          id: String(r.event_id),
          title: String(r.title),
          venueName: String(r.venue_name),
          venueCity: r.venue_city != null ? String(r.venue_city) : null,
          startsAt: r.starts_at,
          endsAt: r.ends_at ?? null,
          status: String(r.status),
          entryQrAllowReentry: Boolean(r.entry_qr_allow_reentry),
          assignedAt: r.assigned_at,
        })),
      });
    },

    volunteerMe: async (req: AuthedRequest, res: Response) => {
      const profile = await volunteerRepo.findVolunteerProfileByUserId(pool, req.userId!);
      if (!profile) throw new HttpError(404, "Volunteer profile not found");
      res.json({
        profile: {
          id: String(profile.id),
          fullName: String(profile.full_name),
          phone: String(profile.phone),
          photoUrl: profile.photo_url != null ? String(profile.photo_url) : null,
        },
      });
    },

    volunteerScanEntry: async (req: AuthedRequest, res: Response) => {
      const eventId = pid(req.params.eventId);
      const body = scanPayloadSchema.parse(req.body);
      const assigned = await volunteerRepo.isVolunteerAssignedToEvent(pool, eventId, req.userId!);
      if (!assigned) throw new HttpError(403, "You are not assigned to scan for this event");
      const result = await processVisitorQrScan(pool, {
        eventId,
        payload: body.payload,
        scannedByUserId: req.userId!,
      });
      res.json(result);
    },
  };
}
