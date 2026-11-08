'use client';

import { useId, useState } from 'react';
import { Button } from './ui/Button';

export default function ResearchBrief({ title, brief }: { title: string; brief: string | null }) {
  const id = useId();
  const [message, setMessage] = useState('');
  if (!brief) return null;

  async function copy() {
    if (!brief) return;
    try {
      await navigator.clipboard.writeText(brief);
      setMessage('Copied.');
    } catch {
      setMessage('Clipboard unavailable. Select and copy the brief below.');
    }
  }

  return <details className="space-y-2 rounded border border-border p-3">
    <summary className="cursor-pointer font-medium">{title}</summary>
    <p className="text-sm text-muted">Review the brief, then paste it into Codex or Claude in this target’s Research console.</p>
    <label htmlFor={id} className="sr-only">{title} brief</label>
    <textarea id={id} readOnly value={brief} rows={7} className="w-full rounded border border-border bg-surface p-2 font-mono text-xs" />
    <Button variant="secondary" size="sm" onClick={() => void copy()}>Copy brief</Button>
    <span role="status" className="ml-2 text-sm">{message}</span>
  </details>;
}
