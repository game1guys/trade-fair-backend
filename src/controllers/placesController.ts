import type { Response } from "express";
import { env } from "../config/env.js";
import type { AuthedRequest } from "../middlewares/authMiddleware.js";
import { suggestPlaces } from "../services/placesService.js";

export function createPlacesController() {
  return {
    suggest: async (req: AuthedRequest, res: Response) => {
      const q = typeof req.query.q === "string" ? req.query.q : "";
      const { suggestions, providerUsed } = await suggestPlaces(q);
      res.json({
        suggestions,
        providerUsed,
        mapsConfigured: Boolean(env.googleMapsApiKey),
      });
    },
  };
}
