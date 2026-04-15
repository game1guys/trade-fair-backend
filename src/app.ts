import cors from "cors";
import express from "express";
import helmet from "helmet";
import pino from "pino";
import { pinoHttp } from "pino-http";
import type { Pool } from "mysql2/promise";
import { env } from "./config/env.js";
import { errorHandler } from "./middlewares/errorHandler.js";
import { registerRoutes } from "./routes/index.js";

export function createApp(pool: Pool) {
  const logger = pino({
    level: env.nodeEnv === "production" ? "info" : "debug",
    transport:
      env.nodeEnv === "development"
        ? { target: "pino-pretty", options: { colorize: true } }
        : undefined,
  });

  const app = express();
  app.use(helmet());
  app.use(
    cors({
      origin: env.corsOrigin,
      credentials: true,
    })
  );
  app.use(
    express.json({
      limit: "1mb",
      verify: (req, _res, buf) => {
        (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
      },
    })
  );
  app.use(
    pinoHttp({
      logger,
      autoLogging: true,
    })
  );

  app.get("/", (_req, res) => {
    res.json({
      ok: true,
      service: "tradefair-api",
      health: `${env.apiPrefix}/health`,
      hint: "Browser: open the health URL above. UI runs in the Next.js /web app (port 3000).",
    });
  });

  const router = express.Router();
  registerRoutes(router, pool);
  app.use(env.apiPrefix, router);

  app.use(errorHandler(logger));

  return app;
}
