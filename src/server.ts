import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { ensureOptionalSchema } from "./db/ensureOptionalSchema.js";
import { pool } from "./db/pool.js";
import { processDueReminders } from "./jobs/reminderTick.js";

async function main() {
  await ensureOptionalSchema(pool);
  const app = createApp(pool);
  app.listen(env.port, () => {
    console.log(`tradefair-api listening on http://127.0.0.1:${env.port}${env.apiPrefix}`);
  });
  setInterval(() => {
    void processDueReminders(pool).catch((err) => console.error("[reminderTick]", err));
  }, 60_000);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
