import { v4 as uuidv4 } from "uuid";

/** New JWT `jti` / opaque correlation id (RFC 4122 UUID v4). */
export function newJti(): string {
  return uuidv4();
}
