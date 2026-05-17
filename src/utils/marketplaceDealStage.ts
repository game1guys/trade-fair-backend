/** UI label for enquiry + contract + optional booking pipeline. */
export function marketplaceDealStage(input: {
  contractStatus?: unknown;
  bookingStatus?: unknown;
  requestStatus?: unknown;
}): string {
  const cs = input.contractStatus != null ? String(input.contractStatus) : null;
  if (cs === "accepted") return "deal_done";
  if (cs === "pending_acceptance") return "contract_pending";
  if (cs === "declined") return "contract_declined";
  if (cs === "cancelled") return "contract_cancelled";

  const bs = input.bookingStatus != null ? String(input.bookingStatus) : null;
  if (bs === "completed") return "deal_done";
  if (bs === "confirmed") return "booked";
  if (bs === "pending_payment") return "awaiting_payment";
  if (bs === "rejected") return "booking_rejected";
  if (bs === "cancelled") return "booking_cancelled";
  const rs = input.requestStatus != null ? String(input.requestStatus) : null;
  if (rs === "closed") return "chat_closed";
  if (rs === "in_progress") return "in_discussion";
  return "enquiry";
}
