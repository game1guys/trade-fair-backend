import type { Pool } from "mysql2/promise";
import * as eventRepo from "../repositories/eventRepository.js";
import * as kycRepo from "../repositories/kycRepository.js";
import * as marketplaceRepo from "../repositories/marketplaceRepository.js";
import * as userRepo from "../repositories/userRepository.js";
import { HttpError } from "../utils/httpError.js";

export type PlanLimitations = {
  maxPublishedEvents?: number;
  maxEventsTotal?: number;
  maxPublishedServices?: number;
  maxServicesTotal?: number;
};

export function parseLimitations(raw: unknown): PlanLimitations {
  if (raw == null) return {};
  let o: unknown = raw;
  if (typeof raw === "string") {
    try {
      o = JSON.parse(raw);
    } catch {
      return {};
    }
  }
  if (typeof o !== "object" || o == null || Array.isArray(o)) return {};
  const x = o as Record<string, unknown>;
  const num = (k: string): number | undefined => {
    const v = x[k];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) return Math.floor(v);
    if (typeof v === "string" && /^\d+$/.test(v)) return Number(v);
    return undefined;
  };
  return {
    maxPublishedEvents: num("maxPublishedEvents"),
    maxEventsTotal: num("maxEventsTotal"),
    maxPublishedServices: num("maxPublishedServices"),
    maxServicesTotal: num("maxServicesTotal"),
  };
}

async function assertOrganizerAccountReady(pool: Pool, userId: bigint): Promise<void> {
  const user = await userRepo.findUserById(pool, userId);
  if (!user) throw new HttpError(401, "Unauthorized");
  const roles = await userRepo.getRoleCodesForUser(pool, userId);
  if (!roles.includes("ORGANIZER")) throw new HttpError(403, "Organizer role required.");
  const kycOk = await kycRepo.hasOrganizerIdentityKycApproved(pool, userId);
  if (!kycOk) {
    throw new HttpError(
      403,
      "Complete organizer KYC first: upload documents under Organizer → KYC and wait until an admin approves at least one qualifying file."
    );
  }
  const sub = await marketplaceRepo.findActiveSubscriptionForRole(pool, userId, "ORGANIZER");
  if (!sub) {
    throw new HttpError(
      403,
      "Subscribe to an organizer plan under Subscription (dashboard) before creating or publishing events."
    );
  }
}

export async function assertOrganizerCanCreateEvent(pool: Pool, organizerUserId: bigint): Promise<void> {
  await assertOrganizerAccountReady(pool, organizerUserId);
  const sub = (await marketplaceRepo.findActiveSubscriptionForRole(pool, organizerUserId, "ORGANIZER"))!;
  const lim = parseLimitations(sub.limitations_json);
  if (lim.maxEventsTotal != null) {
    const cnt = await eventRepo.countOrganizerEvents(pool, organizerUserId, "all_non_cancelled");
    if (cnt >= lim.maxEventsTotal) {
      throw new HttpError(
        403,
        `Your plan allows at most ${lim.maxEventsTotal} events (draft + published). Upgrade or remove drafts to add more.`
      );
    }
  }
}

export async function assertOrganizerCanPublishEvent(pool: Pool, organizerUserId: bigint, eventId: bigint): Promise<void> {
  await assertOrganizerAccountReady(pool, organizerUserId);
  const ev = await eventRepo.findEventById(pool, eventId);
  if (!ev || ev.organizer_user_id !== organizerUserId) throw new HttpError(404, "Event not found");
  const sub = (await marketplaceRepo.findActiveSubscriptionForRole(pool, organizerUserId, "ORGANIZER"))!;
  const lim = parseLimitations(sub.limitations_json);
  if (lim.maxPublishedEvents != null) {
    const published = await eventRepo.countOrganizerEvents(pool, organizerUserId, "published");
    const alreadyPub = ev.status === "published";
    if (!alreadyPub && published >= lim.maxPublishedEvents) {
      throw new HttpError(
        403,
        `Your plan allows at most ${lim.maxPublishedEvents} published fairs. Unpublish one or choose a higher plan.`
      );
    }
  }
}

/** Use when creating a new event already in `published` status (single insert). */
export async function assertOrganizerCanPublishNewEvent(pool: Pool, organizerUserId: bigint): Promise<void> {
  await assertOrganizerAccountReady(pool, organizerUserId);
  const sub = (await marketplaceRepo.findActiveSubscriptionForRole(pool, organizerUserId, "ORGANIZER"))!;
  const lim = parseLimitations(sub.limitations_json);
  if (lim.maxPublishedEvents != null) {
    const published = await eventRepo.countOrganizerEvents(pool, organizerUserId, "published");
    if (published >= lim.maxPublishedEvents) {
      throw new HttpError(
        403,
        `Your plan allows at most ${lim.maxPublishedEvents} published fairs. Unpublish one or choose a higher plan.`
      );
    }
  }
}

export async function assertServiceProviderAccountReady(pool: Pool, userId: bigint): Promise<void> {
  const user = await userRepo.findUserById(pool, userId);
  if (!user) throw new HttpError(401, "Unauthorized");
  const roles = await userRepo.getRoleCodesForUser(pool, userId);
  if (!roles.includes("SERVICE_PROVIDER")) throw new HttpError(403, "Service provider role required.");
  const sub = await marketplaceRepo.findActiveSubscriptionForRole(pool, userId, "SERVICE_PROVIDER");
  if (!sub) {
    throw new HttpError(
      403,
      "Subscribe to a service provider plan (Subscription in your dashboard) before publishing listings."
    );
  }
}

export async function assertServiceProviderCanCreateService(pool: Pool, providerUserId: bigint): Promise<void> {
  await assertServiceProviderAccountReady(pool, providerUserId);
  const sub = (await marketplaceRepo.findActiveSubscriptionForRole(pool, providerUserId, "SERVICE_PROVIDER"))!;
  const lim = parseLimitations(sub.limitations_json);
  if (lim.maxServicesTotal != null) {
    const cnt = await marketplaceRepo.countProviderServices(pool, providerUserId, "all");
    if (cnt >= lim.maxServicesTotal) {
      throw new HttpError(
        403,
        `Your plan allows at most ${lim.maxServicesTotal} service listings (draft + published). Remove drafts or upgrade.`
      );
    }
  }
}

export async function assertServiceProviderCanPublishNewListing(pool: Pool, providerUserId: bigint): Promise<void> {
  await assertServiceProviderAccountReady(pool, providerUserId);
  const sub = (await marketplaceRepo.findActiveSubscriptionForRole(pool, providerUserId, "SERVICE_PROVIDER"))!;
  const lim = parseLimitations(sub.limitations_json);
  if (lim.maxPublishedServices != null) {
    const published = await marketplaceRepo.countProviderServices(pool, providerUserId, "published");
    if (published >= lim.maxPublishedServices) {
      throw new HttpError(
        403,
        `Your plan allows at most ${lim.maxPublishedServices} published services. Unpublish one or choose a higher plan.`
      );
    }
  }
}
