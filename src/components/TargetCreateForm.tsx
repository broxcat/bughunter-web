'use client';

import TargetEditor from './TargetEditor';

export default function TargetCreateForm({ hunterHasUserAgent }: { hunterHasUserAgent: boolean }) {
  return <TargetEditor hunterHasUserAgent={hunterHasUserAgent} importProgram={async (url, platform) => {
    if (platform === 'PRIVATE' || platform === 'OTHER') return { message: 'Manual entry. Add the authorized scope and program rules below.' };
    const response = await fetch('/api/programs/import-preview', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, platform: platform || undefined }),
    });
    const result = await response.json();
    if (result.status === 'PREVIEW') return { preview: result.preview };
    return { message: result.reason === 'connection_required'
      ? 'Connect the platform in Settings to import it, or enter the scope and rules manually.'
      : 'Import is unavailable for this URL. Enter the scope and rules manually.' };
  }} />;
}
