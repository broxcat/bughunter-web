import { auth } from '@/lib/auth';
import { scopeMarkdownDownload } from '@/server/scopeMarkdown';
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; assetId: string }> }) {
  const session = await auth(); if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const { id, assetId } = await params; return scopeMarkdownDownload(session.user.id, id, assetId);
}
