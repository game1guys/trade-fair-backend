import { EventEmitter } from "node:events";

const bus = new EventEmitter();
bus.setMaxListeners(200);

export function emitGateScan(eventId: bigint | string, payload: Record<string, unknown>): void {
  bus.emit(`gate:${eventId}`, payload);
}

export function subscribeGateScan(
  eventId: bigint | string,
  handler: (payload: Record<string, unknown>) => void
): () => void {
  const ch = `gate:${eventId}`;
  bus.on(ch, handler);
  return () => {
    bus.off(ch, handler);
  };
}
