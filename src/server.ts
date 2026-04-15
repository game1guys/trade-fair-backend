import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { pool } from "./db/pool.js";

const app = createApp(pool);

app.listen(env.port, () => {
  console.log(`tradefair-api listening on http://127.0.0.1:${env.port}${env.apiPrefix}`);
});
