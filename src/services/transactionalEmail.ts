import type { Pool } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import * as eventRepo from "../repositories/eventRepository.js";
import * as userRepo from "../repositories/userRepository.js";
import { env } from "../config/env.js";
import { sendSmtpEmail } from "./outboundMessaging.js";

function formatInr(minor: bigint | number | string): string {
  return (Number(minor) / 100).toFixed(2);
}

function parseMetadata(raw: unknown): Record<string, unknown> {
  if (raw == null) return {};
  if (typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}

async function adminRecipientEmails(pool: Pool): Promise<string[]> {
  if (env.platformAdminNotifyEmail) return [env.platformAdminNotifyEmail];
  return userRepo.listPlatformAdminEmails(pool);
}

async function stallLinesForBooking(pool: Pool, bookingId: bigint): Promise<string[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT s.label, s.grid_row, s.grid_col, st.name AS stall_type_name
     FROM booking_items bi
     INNER JOIN stalls s ON s.id = bi.stall_id
     LEFT JOIN stall_types st ON st.id = s.stall_type_id
     WHERE bi.booking_id = ?
     ORDER BY s.grid_row, s.grid_col, s.label`,
    [bookingId]
  );
  return rows.map((r) => {
    const label = String(r.label);
    const type = r.stall_type_name != null ? String(r.stall_type_name) : "Stall";
    const row = r.grid_row != null ? Number(r.grid_row) : null;
    const col = r.grid_col != null ? Number(r.grid_col) : null;
    const pos =
      row != null && col != null ? ` · Grid row ${row}, col ${col}` : row != null ? ` · Row ${row}` : col != null ? ` · Col ${col}` : "";
    return `  • ${label} (${type})${pos}`;
  });
}

function appLoginUrl(): string {
  const base = (env.appPublicUrl || env.corsOrigin || "http://localhost:3000").replace(/\/$/, "");
  return `${base}/login`;
}

function formatEventWhen(startsAt: Date | string, endsAt?: Date | string | null): string {
  const start = new Date(startsAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
  if (!endsAt) return start;
  const end = new Date(endsAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
  return `${start} — ${end}`;
}

function eventBlock(ev: {
  title: string;
  venue_name: string;
  venue_city?: string | null;
  starts_at: Date | string;
  ends_at?: Date | string | null;
}): string {
  const loc = [ev.venue_name, ev.venue_city].filter(Boolean).join(", ");
  return [
    `Event: ${ev.title}`,
    loc ? `Venue: ${loc}` : "",
    `When: ${formatEventWhen(ev.starts_at, ev.ends_at)}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Fire-and-forget — never throws to API handlers. */
export function emailLater(fn: () => Promise<void>): void {
  void fn().catch((e) => {
    console.warn("[email]", e instanceof Error ? e.message : e);
  });
}

export async function emailUser(
  pool: Pool,
  userId: bigint,
  subject: string,
  text: string
): Promise<{ ok: boolean; error?: string }> {
  const user = await userRepo.findUserById(pool, userId);
  if (!user?.email) return { ok: false, error: "No email for user" };
  return sendSmtpEmail({ to: [user.email], subject, text });
}

export async function emailVolunteerNewWithCredentials(
  pool: Pool,
  input: {
    volunteerUserId: bigint;
    fullName: string;
    loginEmail: string;
    password: string;
    eventId: bigint;
  }
): Promise<void> {
  const ev = await eventRepo.findEventById(pool, input.eventId);
  if (!ev) return;
  const text = [
    `Hi ${input.fullName},`,
    "",
    "You have been added as a gate volunteer on Trade Fair Wala.",
    "",
    "Your login:",
    `  Email: ${input.loginEmail}`,
    `  Password: ${input.password}`,
    `  Sign in: ${appLoginUrl()}`,
    "",
    "Assigned fair:",
    eventBlock(ev),
    "",
    "After sign-in, open your volunteer dashboard and tap Scan tickets at the gate.",
    "",
    "— Trade Fair Wala",
  ].join("\n");
  await emailUser(pool, input.volunteerUserId, `Gate volunteer — ${ev.title}`, text);
}

export async function emailVolunteerAssignedExisting(
  pool: Pool,
  input: { volunteerUserId: bigint; fullName: string; eventId: bigint }
): Promise<void> {
  const ev = await eventRepo.findEventById(pool, input.eventId);
  if (!ev) return;
  const text = [
    `Hi ${input.fullName},`,
    "",
    "You have been assigned to scan visitor tickets for:",
    "",
    eventBlock(ev),
    "",
    `Sign in: ${appLoginUrl()}`,
    "Open Volunteer → your event → Scan tickets.",
    "",
    "— Trade Fair Wala",
  ].join("\n");
  await emailUser(pool, input.volunteerUserId, `Volunteer assignment — ${ev.title}`, text);
}

export async function emailVolunteerPoolCreated(
  pool: Pool,
  input: { volunteerUserId: bigint; fullName: string; loginEmail: string; password: string }
): Promise<void> {
  const text = [
    `Hi ${input.fullName},`,
    "",
    "An organiser added you to their volunteer team on Trade Fair Wala.",
    "",
    `  Email: ${input.loginEmail}`,
    `  Password: ${input.password}`,
    `  Sign in: ${appLoginUrl()}`,
    "",
    "You will receive another email when assigned to a specific fair.",
    "",
    "— Trade Fair Wala",
  ].join("\n");
  await emailUser(pool, input.volunteerUserId, "Your volunteer account — Trade Fair Wala", text);
}

export async function emailServiceEnquiryToProvider(
  pool: Pool,
  input: {
    providerUserId: bigint;
    enquirerName: string;
    enquirerEmail: string;
    serviceTitle: string;
    message: string;
    eventTitle?: string | null;
    requestId: bigint;
  }
): Promise<void> {
  const text = [
    `Hello,`,
    "",
    `${input.enquirerName} (${input.enquirerEmail}) sent a new service enquiry.`,
    "",
    `Service: ${input.serviceTitle}`,
    input.eventTitle ? `Fair: ${input.eventTitle}` : "",
    "",
    "Message:",
    input.message,
    "",
    `Reply in your dashboard: ${appLoginUrl()}`,
    `(Enquiry #${input.requestId})`,
    "",
    "— Trade Fair Wala",
  ]
    .filter(Boolean)
    .join("\n");
  await emailUser(pool, input.providerUserId, `New enquiry — ${input.serviceTitle}`, text);
}

export async function emailContractSentToProvider(
  pool: Pool,
  input: {
    providerUserId: bigint;
    organizerName: string;
    serviceDescription: string;
    durationDays: number;
    peopleCount: number;
    eventTitle?: string | null;
    requestId: bigint;
  }
): Promise<void> {
  const text = [
    "A service contract is waiting for your acceptance.",
    "",
    `From: ${input.organizerName}`,
    input.eventTitle ? `Fair: ${input.eventTitle}` : "",
    `Service: ${input.serviceDescription}`,
    `Duration: ${input.durationDays} days · Scale: ${input.peopleCount} people`,
    "",
    `Review & accept: ${appLoginUrl()}`,
    `(Request #${input.requestId})`,
    "",
    "— Trade Fair Wala",
  ]
    .filter(Boolean)
    .join("\n");
  await emailUser(pool, input.providerUserId, "Contract pending your acceptance", text);
}

export async function emailContractAccepted(
  pool: Pool,
  input: {
    organizerUserId: bigint;
    providerUserId: bigint;
    organizerName: string;
    providerName: string;
    serviceDescription: string;
    eventTitle?: string | null;
    requestId: bigint;
  }
): Promise<void> {
  const orgText = [
    `Hi ${input.organizerName},`,
    "",
    `${input.providerName} accepted your service contract.`,
    "",
    input.eventTitle ? `Fair: ${input.eventTitle}` : "",
    `Service: ${input.serviceDescription}`,
    "",
    `View deal: ${appLoginUrl()}`,
    "",
    "— Trade Fair Wala",
  ]
    .filter(Boolean)
    .join("\n");
  const provText = [
    `Hi ${input.providerName},`,
    "",
    "You accepted the organiser contract. The deal is confirmed.",
    "",
    input.eventTitle ? `Fair: ${input.eventTitle}` : "",
    `Service: ${input.serviceDescription}`,
    "",
    `Request #${input.requestId}`,
    "",
    "— Trade Fair Wala",
  ]
    .filter(Boolean)
    .join("\n");
  await Promise.all([
    emailUser(pool, input.organizerUserId, "Contract accepted by provider", orgText),
    emailUser(pool, input.providerUserId, "Contract confirmed", provText),
  ]);
}

export async function notifyStallBookingConfirmed(pool: Pool, bookingId: bigint): Promise<void> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT b.id, b.subtotal_minor, b.currency, u_ex.email AS exhibitor_email, u_ex.full_name AS exhibitor_name,
            u_org.id AS organizer_user_id, u_org.email AS organizer_email, u_org.full_name AS organizer_name,
            e.title, e.venue_name, e.venue_city, e.starts_at, e.ends_at
     FROM bookings b
     INNER JOIN users u_ex ON u_ex.id = b.exhibitor_user_id
     INNER JOIN events e ON e.id = b.event_id
     INNER JOIN users u_org ON u_org.id = e.organizer_user_id
     WHERE b.id = ? AND b.status = 'confirmed'`,
    [bookingId]
  );
  if (!rows.length) return;
  const r = rows[0];
  const amount = formatInr(r.subtotal_minor as string);
  const stalls = await stallLinesForBooking(pool, bookingId);
  const stallBlock = stalls.length ? ["Stalls:", ...stalls].join("\n") : "Stalls: (see dashboard)";
  const evLines = eventBlock({
    title: String(r.title),
    venue_name: String(r.venue_name),
    venue_city: r.venue_city,
    starts_at: r.starts_at,
    ends_at: r.ends_at,
  });
  const exhibitorText = [
    `Hi ${r.exhibitor_name},`,
    "",
    "Your stall booking is confirmed.",
    "",
    evLines,
    "",
    stallBlock,
    "",
    `Amount: ₹${amount} ${r.currency ?? "INR"}`,
    `Booking #${bookingId}`,
    "",
    `Dashboard: ${appLoginUrl()}`,
    "",
    "— Trade Fair Wala",
  ].join("\n");
  const organizerText = [
    `Hi ${r.organizer_name},`,
    "",
    `New confirmed stall booking for ${r.title}.`,
    "",
    `Exhibitor: ${r.exhibitor_name} (${r.exhibitor_email})`,
    "",
    stallBlock,
    "",
    `Amount: ₹${amount}`,
    `Booking #${bookingId}`,
    "",
    `Manage: ${appLoginUrl()}`,
    "",
    "— Trade Fair Wala",
  ].join("\n");
  await Promise.all([
    sendSmtpEmail({ to: [String(r.exhibitor_email)], subject: `Stall booking confirmed — ${r.title}`, text: exhibitorText }),
    emailUser(pool, BigInt(r.organizer_user_id as string), `Stall booked — ${r.title}`, organizerText),
  ]);
}

export async function notifyTicketOrderConfirmed(
  pool: Pool,
  orderId: bigint,
  tickets: { id: string; qrPayload: string }[]
): Promise<void> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT tor.id, tor.quantity, tor.total_minor, tor.currency,
            u_v.id AS visitor_user_id, u_v.email AS visitor_email, u_v.full_name AS visitor_name,
            u_org.id AS organizer_user_id, u_org.full_name AS organizer_name,
            e.title, e.venue_name, e.venue_city, e.starts_at, e.ends_at,
            tt.name AS ticket_type_name
     FROM ticket_orders tor
     INNER JOIN users u_v ON u_v.id = tor.visitor_user_id
     INNER JOIN events e ON e.id = tor.event_id
     INNER JOIN users u_org ON u_org.id = e.organizer_user_id
     LEFT JOIN ticket_types tt ON tt.id = tor.ticket_type_id
     WHERE tor.id = ? AND tor.status = 'paid'`,
    [orderId]
  );
  if (!rows.length) return;
  const r = rows[0];
  const evLines = eventBlock({
    title: String(r.title),
    venue_name: String(r.venue_name),
    venue_city: r.venue_city,
    starts_at: r.starts_at,
    ends_at: r.ends_at,
  });
  const qty = Number(r.quantity ?? tickets.length);
  const typeName = r.ticket_type_name != null ? String(r.ticket_type_name) : "Ticket";
  const totalMinor = BigInt(r.total_minor as string);
  const qrLines =
    tickets.length > 0
      ? tickets.map((t, i) => `  Ticket ${i + 1} — show this QR at entry:\n  ${t.qrPayload}`)
      : ["  (Open your tickets in the app to view QR codes.)"];
  const visitorText = [
    `Hi ${r.visitor_name},`,
    "",
    "Your ticket booking is confirmed.",
    "",
    evLines,
    `Ticket: ${typeName} × ${qty}`,
    totalMinor > 0n ? `Paid: ₹${formatInr(totalMinor)} ${r.currency ?? "INR"}` : "Free entry",
    `Order #${orderId}`,
    "",
    "Entry QR code(s):",
    ...qrLines,
    "",
    `My tickets: ${appLoginUrl()}`,
    "",
    "— Trade Fair Wala",
  ].join("\n");
  const organizerText = [
    `Hi ${r.organizer_name},`,
    "",
    `New ticket booking for ${r.title}.`,
    "",
    `Visitor: ${r.visitor_name} (${r.visitor_email})`,
    `Ticket: ${typeName} × ${qty}`,
    totalMinor > 0n ? `Amount: ₹${formatInr(totalMinor)}` : "Free",
    `Order #${orderId}`,
    "",
    `Event dashboard: ${appLoginUrl()}`,
    "",
    "— Trade Fair Wala",
  ].join("\n");
  await Promise.all([
    sendSmtpEmail({
      to: [String(r.visitor_email)],
      subject: `Tickets confirmed — ${r.title}`,
      text: visitorText,
    }),
    emailUser(pool, BigInt(r.organizer_user_id as string), `New ticket sale — ${r.title}`, organizerText),
  ]);
}

/** Invoice email to payer after any captured payment. */
export async function notifyPaymentInvoice(pool: Pool, paymentId: bigint): Promise<void> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT p.id, p.amount_minor, p.currency, p.payer_user_id, p.booking_id, p.ticket_order_id, p.service_booking_id,
            p.razorpay_payment_id, p.metadata,
            u.email AS payer_email, u.full_name AS payer_name,
            i.invoice_number
     FROM payments p
     INNER JOIN users u ON u.id = p.payer_user_id
     LEFT JOIN invoices i ON i.payment_id = p.id
     WHERE p.id = ? AND p.status = 'captured'`,
    [paymentId]
  );
  if (!rows.length) return;
  const p = rows[0];
  const invoiceNumber =
    p.invoice_number != null ? String(p.invoice_number) : `INV-${new Date().getFullYear()}-${String(paymentId).padStart(8, "0")}`;
  const amount = formatInr(p.amount_minor as string);
  let description = "Payment on Trade Fair Wala";

  if (p.booking_id != null) {
    const bid = BigInt(p.booking_id as string);
    const [br] = await pool.query<RowDataPacket[]>(
      `SELECT e.title FROM bookings b INNER JOIN events e ON e.id = b.event_id WHERE b.id = ?`,
      [bid]
    );
    const stalls = await stallLinesForBooking(pool, bid);
    description = br.length
      ? `Stall booking — ${br[0].title}${stalls.length ? `\n${stalls.join("\n")}` : ""}`
      : "Stall booking";
  } else if (p.ticket_order_id != null) {
    const [tr] = await pool.query<RowDataPacket[]>(
      `SELECT e.title, tt.name AS ticket_type_name, tor.quantity
       FROM ticket_orders tor
       INNER JOIN events e ON e.id = tor.event_id
       LEFT JOIN ticket_types tt ON tt.id = tor.ticket_type_id
       WHERE tor.id = ?`,
      [p.ticket_order_id]
    );
    if (tr.length) {
      description = `Tickets — ${tr[0].title} · ${tr[0].ticket_type_name ?? "Ticket"} × ${tr[0].quantity}`;
    }
  } else if (p.service_booking_id != null) {
    const [sr] = await pool.query<RowDataPacket[]>(
      `SELECT s.title FROM service_bookings sb INNER JOIN services s ON s.id = sb.service_id WHERE sb.id = ?`,
      [p.service_booking_id]
    );
    if (sr.length) description = `Service booking — ${sr[0].title}`;
  }

  const meta = parseMetadata(p.metadata);
  const commissionLine =
    meta.commissionMinor != null && BigInt(String(meta.commissionMinor)) > 0n
      ? `Platform commission (incl. in payment): ₹${formatInr(String(meta.commissionMinor))}`
      : null;

  const text = [
    `Hi ${p.payer_name},`,
    "",
    "Thank you for your payment. Here is your invoice summary.",
    "",
    `Invoice: ${invoiceNumber}`,
    `Amount paid: ₹${amount} ${p.currency ?? "INR"}`,
    p.razorpay_payment_id ? `Payment ref: ${p.razorpay_payment_id}` : "",
    commissionLine ?? "",
    "",
    description,
    "",
    `View payments: ${appLoginUrl()}`,
    "",
    "— Trade Fair Wala",
  ]
    .filter(Boolean)
    .join("\n");

  await sendSmtpEmail({
    to: [String(p.payer_email)],
    subject: `Invoice ${invoiceNumber} — Trade Fair Wala`,
    text,
  });
}

/** When stall booking payment includes platform commission — notify admin + exhibitor. */
export async function notifyStallCommissionRecorded(pool: Pool, paymentId: bigint): Promise<void> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT p.id, p.amount_minor, p.metadata, p.booking_id, p.payer_user_id,
            u.email AS exhibitor_email, u.full_name AS exhibitor_name
     FROM payments p
     INNER JOIN users u ON u.id = p.payer_user_id
     WHERE p.id = ? AND p.booking_id IS NOT NULL AND p.status = 'captured'`,
    [paymentId]
  );
  if (!rows.length) return;
  const p = rows[0];
  const meta = parseMetadata(p.metadata);
  const commissionMinor = meta.commissionMinor != null ? BigInt(String(meta.commissionMinor)) : 0n;
  if (commissionMinor <= 0n) return;

  const bookingId = BigInt(p.booking_id as string);
  const [br] = await pool.query<RowDataPacket[]>(
    `SELECT e.title, e.id AS event_id FROM bookings b INNER JOIN events e ON e.id = b.event_id WHERE b.id = ?`,
    [bookingId]
  );
  if (!br.length) return;
  const eventTitle = String(br[0].title);
  const gross = formatInr(p.amount_minor as string);
  const commission = formatInr(commissionMinor);
  const bps = meta.stallBookingCommissionBps != null ? String(meta.stallBookingCommissionBps) : "";
  const stalls = await stallLinesForBooking(pool, bookingId);
  const stallBlock = stalls.length ? ["Stalls:", ...stalls].join("\n") : "";

  const exhibitorText = [
    `Hi ${p.exhibitor_name},`,
    "",
    `Your stall payment for ${eventTitle} was successful.`,
    "",
    stallBlock,
    "",
    `Amount paid: ₹${gross}`,
    `Platform commission on this booking: ₹${commission}${bps ? ` (${Number(bps) / 100}% of booking)` : ""}`,
    `Payment #${paymentId}`,
    "",
    `Invoice and booking details: ${appLoginUrl()}`,
    "",
    "— Trade Fair Wala",
  ]
    .filter(Boolean)
    .join("\n");

  const adminText = [
    "Platform commission recorded — stall booking payment",
    "",
    `Event: ${eventTitle}`,
    `Exhibitor: ${p.exhibitor_name} (${p.exhibitor_email})`,
    `Booking #${bookingId}`,
    "",
    stallBlock,
    "",
    `Gross: ₹${gross}`,
    `Commission: ₹${commission}`,
    `Payment #${paymentId}`,
    "",
    "— Trade Fair Wala",
  ]
    .filter(Boolean)
    .join("\n");

  const admins = await adminRecipientEmails(pool);
  await sendSmtpEmail({
    to: [String(p.exhibitor_email)],
    subject: `Payment & commission — ${eventTitle}`,
    text: exhibitorText,
  });
  if (admins.length) {
    await sendSmtpEmail({
      to: admins,
      subject: `Commission recorded — ${eventTitle}`,
      text: adminText,
    });
  }
}

export async function emailEnquiryReplyToCustomer(
  pool: Pool,
  input: {
    customerUserId: bigint;
    providerName: string;
    serviceTitle: string;
    replyBody: string;
    requestId: bigint;
  }
): Promise<void> {
  const text = [
    `${input.providerName} replied to your enquiry for "${input.serviceTitle}".`,
    "",
    input.replyBody,
    "",
    `Open thread: ${appLoginUrl()}`,
    `(Enquiry #${input.requestId})`,
    "",
    "— Trade Fair Wala",
  ].join("\n");
  await emailUser(pool, input.customerUserId, `Reply — ${input.serviceTitle}`, text);
}

export async function emailContractDeclined(
  pool: Pool,
  input: {
    organizerUserId: bigint;
    providerUserId: bigint;
    organizerName: string;
    providerName: string;
    serviceDescription: string;
    eventTitle?: string | null;
    requestId: bigint;
    declineNote?: string | null;
  }
): Promise<void> {
  const note = input.declineNote?.trim();
  const orgText = [
    `Hi ${input.organizerName},`,
    "",
    `${input.providerName} declined your service contract.`,
    "",
    input.eventTitle ? `Fair: ${input.eventTitle}` : "",
    `Service: ${input.serviceDescription}`,
    note ? `\nProvider note: ${note}` : "",
    "",
    `You can send a revised contract: ${appLoginUrl()}`,
    `(Request #${input.requestId})`,
    "",
    "— Trade Fair Wala",
  ]
    .filter(Boolean)
    .join("\n");
  const provText = [
    `Hi ${input.providerName},`,
    "",
    "You declined the organiser contract. They have been notified.",
    "",
    input.eventTitle ? `Fair: ${input.eventTitle}` : "",
    `Service: ${input.serviceDescription}`,
    "",
    "— Trade Fair Wala",
  ]
    .filter(Boolean)
    .join("\n");
  await Promise.all([
    emailUser(pool, input.organizerUserId, "Contract declined by provider", orgText),
    emailUser(pool, input.providerUserId, "Contract declined — confirmation", provText),
  ]);
}

/** After payment row + invoice exist — invoice to payer; commission alerts for stall bookings. */
export async function notifyAfterPaymentRecorded(pool: Pool, paymentId: bigint): Promise<void> {
  await notifyPaymentInvoice(pool, paymentId);
  await notifyStallCommissionRecorded(pool, paymentId);
}

export async function emailKycApprovedOrganizer(pool: Pool, organizerUserId: bigint): Promise<void> {
  const user = await userRepo.findUserById(pool, organizerUserId);
  if (!user) return;
  const text = [
    `Hi ${user.full_name},`,
    "",
    "Your organiser KYC document has been approved by our team.",
    "",
    "You can continue publishing fairs and using organiser features.",
    "",
    `Dashboard: ${appLoginUrl()}`,
    "",
    "— Trade Fair Wala",
  ].join("\n");
  await emailUser(pool, organizerUserId, "KYC approved — Trade Fair Wala", text);
}

export async function emailServiceRequestMessage(
  pool: Pool,
  input: {
    toUserId: bigint;
    fromName: string;
    serviceTitle: string;
    messageBody: string;
    requestId: bigint;
  }
): Promise<void> {
  const text = [
    `New message from ${input.fromName} on enquiry for "${input.serviceTitle}".`,
    "",
    input.messageBody,
    "",
    `Open chat: ${appLoginUrl()}`,
    `(Request #${input.requestId})`,
    "",
    "— Trade Fair Wala",
  ].join("\n");
  await emailUser(pool, input.toUserId, `New message — ${input.serviceTitle}`, text);
}
