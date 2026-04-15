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
loadEnvFile(path.join(monorepoRoot, ".env"), false);
loadEnvFile(path.join(backendRoot, ".env"), true);

function trim(s: string | undefined): string {
  return (s ?? "").trim();
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 4000),
  apiPrefix: process.env.API_PREFIX ?? "/api/v1",
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
  razorpay: {
    keyId: trim(process.env.RAZORPAY_KEY_ID),
    keySecret: trim(process.env.RAZORPAY_KEY_SECRET),
    /** Must be the signing secret from Razorpay Dashboard → Webhooks (same app as KEY_ID), not the API key secret. */
    webhookSecret: trim(process.env.RAZORPAY_WEBHOOK_SECRET),
  },
};
