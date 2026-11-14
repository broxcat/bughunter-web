import { z } from 'zod';
/**
 * B6: dynamic API path parameters are opaque identifiers (cuid, UUID or a
 * prefixed form such as EV-<uuid>). Anything else is treated as not found
 * before it reaches the database layer.
 */
export const ROUTE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
export const routeIdSchema = z.string().regex(ROUTE_ID_PATTERN);
export function routeId(value: unknown): string | null {
  const parsed = routeIdSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
