import type { Pool } from "mysql2/promise";
import * as eventReminderRepo from "../repositories/eventReminderRepository.js";
import * as organizerReadRepo from "../repositories/organizerReadRepository.js";
import { sendSmtpEmail, sendWhatsAppCloud } from "../services/outboundMessaging.js";

/** Called periodically from the API process to fire due reminders. */
export async function processDueReminders(pool: Pool): Promise<void> {
  const due = await eventReminderRepo.listDueScheduledReminders(pool, 30);
  for (const r of due) {
    try {
      let emails: string[] = [];
      let phones: string[] = [];
      if (r.audience === "exhibitors") {
        emails = await organizerReadRepo.listExhibitorEmailsForEvent(pool, r.eventId);
        phones = await organizerReadRepo.listExhibitorPhonesForEvent(pool, r.eventId);
      } else if (r.audience === "visitors") {
        emails = await organizerReadRepo.listVisitorEmailsForEvent(pool, r.eventId);
        phones = await organizerReadRepo.listVisitorPhonesForEvent(pool, r.eventId);
      } else {
        emails = [
          ...new Set([
            ...(await organizerReadRepo.listExhibitorEmailsForEvent(pool, r.eventId)),
            ...(await organizerReadRepo.listVisitorEmailsForEvent(pool, r.eventId)),
          ]),
        ];
        phones = [
          ...new Set([
            ...(await organizerReadRepo.listExhibitorPhonesForEvent(pool, r.eventId)),
            ...(await organizerReadRepo.listVisitorPhonesForEvent(pool, r.eventId)),
          ]),
        ];
      }

      const subject = r.title?.trim() ? r.title : "Event reminder";
      const bodyText = r.body;

      if (r.channel === "email" || r.channel === "both") {
        await sendSmtpEmail({ to: emails, subject, text: bodyText });
      }
      if (r.channel === "whatsapp" || r.channel === "both") {
        for (const ph of phones.slice(0, 100)) {
          await sendWhatsAppCloud(ph, `${subject}\n\n${bodyText}`);
        }
      }

      await eventReminderRepo.setReminderStatus(pool, r.id, "sent");
    } catch {
      await eventReminderRepo.setReminderStatus(pool, r.id, "cancelled");
    }
  }
}
