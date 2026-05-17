import type { Pool } from "mysql2/promise";
import { env } from "../config/env.js";
import * as eventRepo from "../repositories/eventRepository.js";
import * as marketplaceRepo from "../repositories/marketplaceRepository.js";
import * as organizerPayoutRepo from "../repositories/organizerPayoutRepository.js";
import * as paymentRepo from "../repositories/paymentRepository.js";
import * as razorpay from "./razorpayService.js";

/**
 * After stall booking payment is recorded, optionally move organizer share to their Razorpay Route linked account.
 * Platform keeps (gross − organizerShare) = commission from plan `stall_booking_commission_bps` on the gross amount.
 */
export async function maybeRouteTransferOrganizerShareAfterBookingPayment(
  pool: Pool,
  input: {
    paymentId: bigint;
    eventId: bigint;
    razorpayPaymentId: string;
    grossMinor: bigint;
  }
): Promise<void> {
  if (!env.razorpay.routeTransfersEnabled) return;

  const bps = await marketplaceRepo.getStallBookingCommissionBpsForEvent(pool, input.eventId);
  const commissionMinor = (input.grossMinor * BigInt(bps)) / 10000n;
  const organizerShare = input.grossMinor - commissionMinor;
  if (organizerShare < 1n) return;

  const ev = await eventRepo.findEventById(pool, input.eventId);
  if (!ev) return;
  const profile = await organizerPayoutRepo.findOrganizerPayoutProfile(pool, ev.organizer_user_id);
  const linked = profile?.razorpayLinkedAccountId?.trim();
  if (!linked) return;

  const amountNum = Number(organizerShare);
  if (!Number.isFinite(amountNum) || amountNum < 1) return;

  try {
    const routeResponse = await razorpay.createTransfersForCapturedPayment(input.razorpayPaymentId, [
      { account: linked, amount: amountNum, currency: "INR" },
    ]);
    await paymentRepo.mergePaymentMetadata(pool, input.paymentId, {
      routeTransferStatus: "created",
      routeTransferResponse: routeResponse,
      organizerShareMinor: String(organizerShare),
      platformCommissionMinor: String(commissionMinor),
      stallBookingCommissionBps: bps,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await paymentRepo.mergePaymentMetadata(pool, input.paymentId, {
      routeTransferStatus: "failed",
      routeTransferError: msg,
      organizerShareMinor: String(organizerShare),
      platformCommissionMinor: String(commissionMinor),
      stallBookingCommissionBps: bps,
    });
  }
}
