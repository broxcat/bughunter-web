import { redirect } from 'next/navigation';
export default async function ScopePage({ params }: { params: Promise<{ id: string }> }) {
  redirect(`/targets/${encodeURIComponent((await params).id)}?tab=Scope`);
}
