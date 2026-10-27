import Link from 'next/link';
export default function CreateResearchButton({ targetId, disabled = false }: { targetId: string; disabled?: boolean }) {
  return disabled || !targetId ? <span className="text-muted">Research unavailable</span> : <Link className="text-brand" href={`/research/${targetId}`}>Open Codex console</Link>;
}
