import { env } from "../config/env.js";
import { HttpError } from "../utils/httpError.js";

export type PlaceSuggestion = {
  id: string;
  label: string;
  venueName: string;
  addressLine: string;
  city: string;
  country: string;
  latitude: number;
  longitude: number;
};

type AddressComponent = {
  long_name: string;
  short_name: string;
  types: string[];
};

type GeocodeResult = {
  formatted_address: string;
  place_id: string;
  geometry?: { location?: { lat: number; lng: number } };
  address_components?: AddressComponent[];
};

type GeocodeResponse = {
  status: string;
  results?: GeocodeResult[];
  error_message?: string;
};

function pickLong(components: AddressComponent[], ...wantTypes: string[]): string {
  for (const t of wantTypes) {
    const hit = components.find((c) => c.types.includes(t));
    if (hit?.long_name) return hit.long_name;
  }
  return "";
}

/** Lowercase alphanumerics only — "Green Park" and "greenpark" align. */
function collapseAlnum(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function queryTokens(q: string): string[] {
  const spaced = q.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const words = spaced.split(/\s+/).filter((x) => x.length >= 2);
  const out = new Set<string>(words);
  const collapsed = collapseAlnum(q);
  if (collapsed.length >= 3) out.add(collapsed);
  return [...out];
}

/** How well `name` reflects what the user typed (substring / collapsed match). */
function matchScore(name: string, tokens: string[]): number {
  if (!name || !tokens.length) return 0;
  const n = collapseAlnum(name);
  let s = 0;
  for (const t of tokens) {
    const tc = collapseAlnum(t);
    if (tc.length < 2) continue;
    if (n.includes(tc)) s += tc.length;
  }
  return s;
}

function isNeighborhoodLike(types: string[]): boolean {
  return types.some((t) =>
    ["neighborhood", "sublocality_level_1", "sublocality_level_2", "sublocality", "sublocality_level_3", "park", "natural_feature"].includes(t)
  );
}

function isPoiLike(types: string[]): boolean {
  return types.some((t) => ["point_of_interest", "establishment", "premise", "subpremise", "tourist_attraction"].includes(t));
}

/**
 * Pick a human venue title. Google often puts the well-known area first in `formatted_address`
 * ("Green Park, Permat, Kanpur…") while `establishment` is an obscure business name — prefer the former.
 */
function pickVenueNameFromGoogle(r: GeocodeResult, userQuery: string): string {
  const tokens = queryTokens(userQuery);
  const c = r.address_components ?? [];
  const firstSeg = r.formatted_address?.split(",")[0]?.trim() ?? "";

  if (firstSeg && matchScore(firstSeg, tokens) > 0) {
    return firstSeg;
  }

  let bestNeigh = "";
  let bestNeighScore = 0;
  let bestPoi = "";
  let bestPoiScore = 0;
  for (const comp of c) {
    const ln = comp.long_name;
    const ms = matchScore(ln, tokens);
    if (isNeighborhoodLike(comp.types) && ms >= bestNeighScore) {
      bestNeighScore = ms;
      bestNeigh = ln;
    }
    if (isPoiLike(comp.types) && ms >= bestPoiScore) {
      bestPoiScore = ms;
      bestPoi = ln;
    }
  }
  if (bestNeighScore > 0) return bestNeigh;
  if (bestPoiScore > bestNeighScore && bestPoi) return bestPoi;

  const neigh = pickLong(
    c,
    "neighborhood",
    "sublocality_level_1",
    "sublocality_level_2",
    "sublocality",
    "park",
    "natural_feature"
  );
  if (neigh) return neigh;

  if (firstSeg) return firstSeg;

  const poi = pickLong(c, "point_of_interest", "establishment", "premise", "tourist_attraction");
  if (poi) return poi;

  return pickLong(c, "locality", "administrative_area_level_2") || "Location";
}

function cityFromGoogleComponents(c: AddressComponent[]): string {
  return pickLong(
    c,
    "locality",
    "postal_town",
    "administrative_area_level_3",
    "administrative_area_level_2",
    "sublocality_level_1"
  );
}

function countryFromGoogleComponents(c: AddressComponent[]): string {
  return pickLong(c, "country");
}

/** Google Maps Geocoding API (server key only). */
async function suggestGoogleGeocode(q: string): Promise<PlaceSuggestion[]> {
  const key = env.googleMapsApiKey;
  if (!key) return [];

  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", q);
  url.searchParams.set("key", key);
  const region = env.googleMapsRegion;
  if (region.length === 2) url.searchParams.set("region", region.toLowerCase());

  const res = await fetch(url.toString());
  const data = (await res.json()) as GeocodeResponse;

  if (data.status === "REQUEST_DENIED" || data.status === "INVALID_REQUEST") {
    throw new HttpError(502, data.error_message || `Google Geocoding: ${data.status}`);
  }
  if (data.status === "OVER_QUERY_LIMIT") {
    throw new HttpError(502, "Google Maps quota exceeded; try again later.");
  }
  if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
    throw new HttpError(502, `Google Geocoding: ${data.status}`);
  }

  const queryTrim = q.trim();
  const results = data.results ?? [];
  return results.slice(0, 8).map((r) => {
    const c = r.address_components ?? [];
    const lat = r.geometry?.location?.lat;
    const lng = r.geometry?.location?.lng;
    const city = cityFromGoogleComponents(c);
    const country = countryFromGoogleComponents(c);
    const venueName = pickVenueNameFromGoogle(r, queryTrim);
    return {
      id: r.place_id,
      label: r.formatted_address,
      venueName,
      addressLine: r.formatted_address,
      city,
      country,
      latitude: lat ?? NaN,
      longitude: lng ?? NaN,
    };
  }).filter((x) => Number.isFinite(x.latitude) && Number.isFinite(x.longitude));
}

function cityFromAddress(addr: Record<string, string> | undefined): string {
  if (!addr) return "";
  const keys = ["city", "town", "village", "hamlet", "suburb", "neighbourhood", "municipality", "state_district"];
  for (const k of keys) {
    if (addr[k]) return addr[k];
  }
  return "";
}

/** OpenStreetMap Nominatim fallback (no API key). */
async function suggestNominatim(q: string): Promise<PlaceSuggestion[]> {
  const query = q.trim();
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", "8");

  const res = await fetch(url.toString(), {
    headers: {
      "User-Agent": "TradeFairWala/1.0 (https://github.com/tradefair-wala)",
      "Accept-Language": "en",
    },
  });
  if (!res.ok) throw new HttpError(502, "Place search temporarily unavailable");

  const raw = (await res.json()) as Record<string, unknown>[];

  return raw
    .map((item, idx) => {
      const addr = (item.address as Record<string, string>) || {};
      const lat = Number(item.lat);
      const lon = Number(item.lon);
      const name = typeof item.name === "string" ? item.name : "";
      const display = typeof item.display_name === "string" ? item.display_name : name;
      const city = cityFromAddress(addr);
      const country = addr.country || "";
      const venueName = (name || display.split(",")[0] || display).trim();
      const id = String(item.osm_id ?? item.place_id ?? idx);
      return {
        id,
        label: display,
        venueName,
        addressLine: display,
        city,
        country,
        latitude: lat,
        longitude: lon,
      };
    })
    .filter((x) => Number.isFinite(x.latitude) && Number.isFinite(x.longitude));
}

export type SuggestPlacesResult = {
  suggestions: PlaceSuggestion[];
  /** Which backend produced the returned list (Google when Geocoding returned hits). */
  providerUsed: "google" | "osm";
};

/**
 * Venue / address suggestions. Uses Google Maps Geocoding when `GOOGLE_MAPS_API_KEY` is set;
 * if Google returns no hits, falls back to OpenStreetMap Nominatim.
 */
export async function suggestPlaces(q: string): Promise<SuggestPlacesResult> {
  const query = q.trim();
  if (query.length < 2) return { suggestions: [], providerUsed: "osm" };
  if (query.length > 200) throw new HttpError(400, "Search query too long");

  if (env.googleMapsApiKey) {
    try {
      const g = await suggestGoogleGeocode(query);
      if (g.length > 0) return { suggestions: g, providerUsed: "google" };
    } catch (e) {
      // Misconfigured key / quota: surface so the operator can fix Google Cloud.
      if (e instanceof HttpError) throw e;
    }
    const osm = await suggestNominatim(query);
    return { suggestions: osm, providerUsed: "osm" };
  }

  const osm = await suggestNominatim(query);
  return { suggestions: osm, providerUsed: "osm" };
}
