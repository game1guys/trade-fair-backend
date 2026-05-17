import type { Pool } from "mysql2/promise";
import type { EventRow } from "../repositories/eventRepository.js";
import * as eventRepo from "../repositories/eventRepository.js";
import * as ticketRepo from "../repositories/ticketOrderRepository.js";
import { emitGateScan } from "../realtime/gateBus.js";
import { sha256Hex } from "../utils/crypto.js";
import { HttpError } from "../utils/httpError.js";

export type EntryScanResult = {
  result: "valid" | "invalid" | "already_used" | "wrong_event";
  ticketId?: string;
  entryQrAllowReentry?: boolean;
};

export async function processVisitorQrScan(
  pool: Pool,
  input: {
    eventId: bigint;
    payload: string;
    scannedByUserId: bigint;
  }
): Promise<EntryScanResult> {
  const ev = await eventRepo.findEventById(pool, input.eventId);
  if (!ev) throw new HttpError(404, "Event not found");

  const parts = input.payload.trim().split(".");
  if (parts.length !== 3 || parts[0] !== "TFW1") throw new HttpError(400, "Invalid QR format");
  const raw = parts[2];
  const hash = sha256Hex(raw);
  const row = await ticketRepo.findTicketByQrHash(pool, hash);

  if (!row) {
    await ticketRepo.insertEntryScan(pool, {
      ticketId: null,
      eventId: input.eventId,
      scannedByUserId: input.scannedByUserId,
      result: "invalid",
    });
    emitGateScan(input.eventId, {
      result: "invalid",
      ticketId: null,
      scannedAt: new Date().toISOString(),
    });
    return { result: "invalid" };
  }

  if (row.event_id !== input.eventId) {
    await ticketRepo.insertEntryScan(pool, {
      ticketId: row.ticket_id,
      eventId: input.eventId,
      scannedByUserId: input.scannedByUserId,
      result: "wrong_event",
    });
    emitGateScan(input.eventId, {
      result: "wrong_event",
      ticketId: String(row.ticket_id),
      scannedAt: new Date().toISOString(),
    });
    return { result: "wrong_event", ticketId: String(row.ticket_id) };
  }

  const allowReentry = Boolean((ev as EventRow).entry_qr_allow_reentry);
  if (!allowReentry) {
    if (row.status !== "unused") {
      await ticketRepo.insertEntryScan(pool, {
        ticketId: row.ticket_id,
        eventId: input.eventId,
        scannedByUserId: input.scannedByUserId,
        result: "already_used",
      });
      emitGateScan(input.eventId, {
        result: "already_used",
        ticketId: String(row.ticket_id),
        scannedAt: new Date().toISOString(),
      });
      return { result: "already_used", ticketId: String(row.ticket_id) };
    }
    const used = await ticketRepo.markTicketUsed(pool, row.ticket_id);
    if (!used) {
      await ticketRepo.insertEntryScan(pool, {
        ticketId: row.ticket_id,
        eventId: input.eventId,
        scannedByUserId: input.scannedByUserId,
        result: "already_used",
      });
      emitGateScan(input.eventId, {
        result: "already_used",
        ticketId: String(row.ticket_id),
        scannedAt: new Date().toISOString(),
      });
      return { result: "already_used", ticketId: String(row.ticket_id) };
    }
  }

  await ticketRepo.insertEntryScan(pool, {
    ticketId: row.ticket_id,
    eventId: input.eventId,
    scannedByUserId: input.scannedByUserId,
    result: "valid",
  });
  emitGateScan(input.eventId, {
    result: "valid",
    ticketId: String(row.ticket_id),
    scannedAt: new Date().toISOString(),
  });
  return {
    result: "valid",
    ticketId: String(row.ticket_id),
    entryQrAllowReentry: allowReentry,
  };
}
