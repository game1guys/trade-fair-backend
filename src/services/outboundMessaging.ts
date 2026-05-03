import nodemailer from "nodemailer";
import { env } from "../config/env.js";

export async function sendSmtpEmail(opts: {
  to: string[];
  subject: string;
  text: string;
  replyTo?: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (!env.smtp.host || opts.to.length === 0) {
    return { ok: false, error: "SMTP not configured or no recipients" };
  }
  try {
    const transporter = nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      secure: env.smtp.port === 465,
      auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.pass } : undefined,
    });
    await transporter.sendMail({
      from: env.smtp.from,
      bcc: opts.to.join(", "),
      subject: opts.subject,
      text: opts.text,
      replyTo: opts.replyTo,
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** WhatsApp Cloud API — requires a registered sender; marketing rules apply in production. */
export async function sendWhatsAppCloud(toE164Digits: string, body: string): Promise<{ ok: boolean; error?: string }> {
  if (!env.whatsapp.token || !env.whatsapp.phoneNumberId) {
    return { ok: false, error: "WhatsApp Cloud API not configured" };
  }
  const to = toE164Digits.replace(/\D/g, "");
  if (!to) return { ok: false, error: "Invalid phone" };
  try {
    const url = `https://graph.facebook.com/v21.0/${env.whatsapp.phoneNumberId}/messages`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.whatsapp.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body },
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      return { ok: false, error: t.slice(0, 400) };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
