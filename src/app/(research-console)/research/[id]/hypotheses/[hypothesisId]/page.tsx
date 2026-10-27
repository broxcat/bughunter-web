import { redirect } from 'next/navigation';
export default async function HistoricalHypothesis({ params }: { params: Promise<{ id: string; hypothesisId: string }> }) {
  const { id, hypothesisId } = await params;
  redirect(`/research/history/${encodeURIComponent(id)}/hypotheses/${encodeURIComponent(hypothesisId)}`);
}
