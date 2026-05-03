import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Backend package root (`trade-fair-backend/`). */
export const backendRoot = path.resolve(__dirname, "..");

/** Local disk uploads (served under `${apiPrefix}/static/uploads`). */
export const uploadsRoot = path.join(backendRoot, "uploads");
