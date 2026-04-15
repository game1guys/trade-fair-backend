import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import type { Logger } from "pino";
import { HttpError } from "../utils/httpError.js";

export function errorHandler(logger: Logger) {
  return (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
      return res.status(400).json({
        error: "Validation failed",
        details: err.flatten(),
      });
    }

    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.message });
    }

    const message = err instanceof Error ? err.message : "Internal server error";
    const status =
      err instanceof Error && "status" in err && typeof (err as { status?: number }).status === "number"
        ? (err as { status: number }).status
        : 500;

    if (status >= 500) {
      logger.error({ err }, "Unhandled error");
    }

    return res.status(status).json({
      error: message,
    });
  };
}
