import { auth } from '@/lib/auth';
async function retired(...args: unknown[]) {
  void args;
  const session = await auth();
  if (!session?.user?.id) return Response.json({error:'Unauthorized'}, {status:401});
  return Response.json({error:'White-box assessment configuration is retired'}, {status:410});
}
export { retired as GET, retired as POST };
