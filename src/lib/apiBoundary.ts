import { z } from 'zod';
import { routeIdSchema } from './routeParams';

const integer = (max: number) => z.string().regex(/^[1-9]\d*$/).refine(value => Number.isSafeInteger(Number(value)) && Number(value) <= max);
export const apiQuerySchema = z.object({
  id: routeIdSchema.optional(), targetId: routeIdSchema.optional(), programId: routeIdSchema.optional(),
  credentialId: routeIdSchema.optional(), scanRunId: routeIdSchema.optional(), runId: routeIdSchema.optional(),
  scopeAssetId: routeIdSchema.optional(), current: routeIdSchema.optional(), previous: routeIdSchema.optional(), run: routeIdSchema.optional(),
  ids: z.string().transform(value => value.split(',')).pipe(z.array(routeIdSchema).min(1).max(100)).optional(),
  page: integer(1_000_000).optional(), pageSize: integer(100).optional(), revisionPage: integer(1_000_000).optional(),
  q: z.string().max(200).optional(),
});
type Context = { params: Promise<Record<string, unknown>> };
/** Runs inside each handler export, independent of Next's proxy and auth.
 * Route-specific body/enum schemas and ownership checks remain in the handler. */
export function withApiBoundary<H>(handler: H, keys: readonly string[] = []): H {
  const wrapped = async (request: Request = new Request('http://handler.invalid/'), context?: Context) => {
    if (keys.length) {
      const schema = z.object(Object.fromEntries(keys.map(key => [key, routeIdSchema]))).strict();
      if (!schema.safeParse(await context?.params).success) return Response.json({ error: 'Not found' }, { status: 404 });
    }
    const search = new URL(request.url).searchParams;
    if ([...new Set(search.keys())].some(key => search.getAll(key).length > 1) || !apiQuerySchema.safeParse(Object.fromEntries(search)).success)
      return Response.json({ error: 'Invalid query parameters' }, { status: 400 });
    return (handler as (req: Request, context?: Context) => unknown)(request, context);
  };
  return wrapped as H;
}
