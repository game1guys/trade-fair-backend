import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Load `.env` from predictable paths (not cwd) so Razorpay/MySQL secrets match when run via monorepo scripts. */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, "../..");
const monorepoRoot = path.resolve(backendRoot, "..");
function loadEnvFile(file: string, override: boolean) {
  if (fs.existsSync(file)) dotenv.config({ path: file, override });
}
// In tests, Vitest sets env vars dynamically; don't let dotenv override them at import-time.
const isTestRun = process.env.NODE_ENV === "test" || process.env.VITEST === "true";
if (!isTestRun) {
  loadEnvFile(path.join(monorepoRoot, ".env"), false);
  loadEnvFile(path.join(backendRoot, ".env"), true);
}

function trim(s: string | undefined): string {
  return (s ?? "").trim().replace(/^["']|["']$/g, "");
}

function smtpPass(): string {
  return (process.env.SMTP_PASS ?? "").trim().replace(/^["']|["']$/g, "").replace(/\s+/g, "");
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 4000),
  apiPrefix: process.env.API_PREFIX ?? "/api/v1",
  /** When true, `POST /visitor/tickets/demo` creates a free demo ticket + QR (also allowed when nodeEnv !== production). */
  demoVisitorTickets: process.env.DEMO_VISITOR_TICKETS === "true",
  /**
   * When true, organizer KYC uploads are marked approved immediately (no admin step).
   * Default: on in non-production unless AUTO_APPROVE_KYC=false; in production only if AUTO_APPROVE_KYC=true.
   */
  autoApproveKycOnUpload:
    !isTestRun &&
    (process.env.AUTO_APPROVE_KYC === "true" ||
      (process.env.NODE_ENV === "production" ? false : process.env.AUTO_APPROVE_KYC !== "false")),
  mysql: {
    host: trim(process.env.MYSQL_HOST) || "127.0.0.1",
    port: Number(process.env.MYSQL_PORT ?? 3306),
    user: trim(process.env.MYSQL_USER) || "root",
    password: process.env.MYSQL_PASSWORD ?? "",
    database: trim(process.env.MYSQL_DATABASE) || "tradefair",
  },
  jwt: {
    accessSecret: trim(process.env.JWT_ACCESS_SECRET) || "dev-only-change-in-production-access-32chars",
    refreshSecret: trim(process.env.JWT_REFRESH_SECRET) || "dev-only-change-in-production-refresh-32ch",
    accessExpires: process.env.JWT_ACCESS_EXPIRES ?? "15m",
    refreshExpires: process.env.JWT_REFRESH_EXPIRES ?? "7d",
  },
  corsOrigin: trim(process.env.CORS_ORIGIN) || "http://localhost:3000",
  /** Public app URL for links in transactional emails (defaults to CORS_ORIGIN). */
  appPublicUrl: trim(process.env.FRONTEND_URL) || trim(process.env.APP_PUBLIC_URL) || trim(process.env.CORS_ORIGIN) || "http://localhost:3000",
  /** Optional override for platform commission / ops alerts (else SUPER_ADMIN + SUB_ADMIN emails). */
  platformAdminNotifyEmail: trim(process.env.ADMIN_NOTIFY_EMAIL) || trim(process.env.SUPER_ADMIN_EMAIL) || "",
  /** Server-only Geocoding API key (never expose to the browser). When set, venue search prefers Google over OSM. */
  googleMapsApiKey: trim(process.env.GOOGLE_MAPS_API_KEY),
  /** Optional region bias for Google Geocoding (ISO 3166-1 alpha-2), e.g. `in` for India. */
  googleMapsRegion: trim(process.env.GOOGLE_MAPS_REGION) || "in",
  razorpay: {
    keyId: trim(process.env.RAZORPAY_KEY_ID),
    keySecret: trim(process.env.RAZORPAY_KEY_SECRET),
    /** Must be the signing secret from Razorpay Dashboard → Webhooks (same app as KEY_ID), not the API key secret. */
    webhookSecret: trim(process.env.RAZORPAY_WEBHOOK_SECRET),
    /**
     * When true, after a stall booking payment is captured we call Razorpay Route
     * `POST /v1/payments/{id}/transfers` to send (gross − platform commission) to the organizer's linked account.
     * Requires Route on your Razorpay merchant account and `razorpay_linked_account_id` saved per organizer.
     */
    routeTransfersEnabled: trim(process.env.RAZORPAY_ROUTE_TRANSFERS_ENABLED) === "true",
    /**
     * When true, saving organizer payout with bank+IFSC (no existing acc_, no manual acc_) calls Razorpay
     * Route v2 onboarding (linked account + stakeholder + product + settlements). Requires valid API keys,
     * Route on the merchant account, and user email + phone on file.
     */
    routeAutoLinkedAccount: trim(process.env.RAZORPAY_ROUTE_AUTO_LINKED_ACCOUNT) === "true",
    /** Optional PAN (ABCDE1234F) used for stakeholder KYC when request body omits stakeholderPan. Sandbox only recommended. */
    routeStakeholderPanFallback: trim(process.env.RAZORPAY_ROUTE_STAKEHOLDER_PAN).toUpperCase() || undefined,
    routeLinkedAccountDefaults: {
      businessType: trim(process.env.RAZORPAY_ROUTE_LINKED_BUSINESS_TYPE) || "individual",
      category: trim(process.env.RAZORPAY_ROUTE_LINKED_CATEGORY) || "healthcare",
      subcategory: trim(process.env.RAZORPAY_ROUTE_LINKED_SUBCATEGORY) || "clinic",
      street1: trim(process.env.RAZORPAY_ROUTE_LINKED_ADDRESS_STREET1) || "Registered office",
      city: trim(process.env.RAZORPAY_ROUTE_LINKED_ADDRESS_CITY) || "Mumbai",
      state: trim(process.env.RAZORPAY_ROUTE_LINKED_ADDRESS_STATE) || "MH",
      postalCode: trim(process.env.RAZORPAY_ROUTE_LINKED_ADDRESS_POSTAL) || "400001",
    },
  },
  /** Optional SMTP for organizer bulk email & scheduled reminders. */
  smtp: {
    host: trim(process.env.SMTP_HOST),
    port: Number(process.env.SMTP_PORT ?? 587),
    user: trim(process.env.SMTP_USER),
    pass: smtpPass(),
    from: trim(process.env.SMTP_FROM) || trim(process.env.SMTP_USER) || "noreply@localhost",
  },
  /** Meta WhatsApp Cloud API (optional). */
  whatsapp: {
    token: trim(process.env.WHATSAPP_CLOUD_TOKEN),
    phoneNumberId: trim(process.env.WHATSAPP_PHONE_NUMBER_ID),
  },
};

export function allowDemoVisitorTickets(): boolean {
  return env.demoVisitorTickets || env.nodeEnv !== "production";
}
