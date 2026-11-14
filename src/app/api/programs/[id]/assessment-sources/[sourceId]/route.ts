import { withApiBoundary } from '@/lib/apiBoundary';
import { auth } from '@/lib/auth';
async function retired(...args: unknown[]) {
  void args;
  const session = await auth();
  if (!session?.user?.id) return Response.json({error:'Unauthorized'}, {status:401});
  return Response.json({error:'White-box assessment configuration is retired'}, {status:410});
}
export const PATCH = withApiBoundary(retired, ['id', 'sourceId']);
export const DELETE = withApiBoundary(retired, ['id', 'sourceId']);
