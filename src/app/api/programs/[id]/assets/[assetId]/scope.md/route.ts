import { withApiBoundary } from '@/lib/apiBoundary';
import { auth } from '@/lib/auth';
import { scopeMarkdownDownload } from '@/server/scopeMarkdown';
 async function handleGET(_req: Request, { params }: { params: Promise<{ id: string; assetId: string }> }) {
  const session = await auth(); if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const { id, assetId } = await params; return scopeMarkdownDownload(session.user.id, id, assetId);
}

export const GET = withApiBoundary(handleGET, ["id","assetId"]);
