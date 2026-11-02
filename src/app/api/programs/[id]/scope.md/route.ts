import { auth } from '@/lib/auth';
import { scopeMarkdownDownload } from '@/server/scopeMarkdown';
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth(); if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  return scopeMarkdownDownload(session.user.id, (await params).id);
}
