import { redirect } from 'next/navigation';
export default async function ReconPage({ searchParams }: { searchParams: Promise<{ program?: string }> }) {
  const { program } = await searchParams;
  redirect(program ? `/targets/${encodeURIComponent(program)}?tab=Recon` : '/targets');
}
