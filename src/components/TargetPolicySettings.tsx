'use client';

import TargetEditor from './TargetEditor';
import type { ProgramData } from '@/lib/targetFormData';

export default function TargetPolicySettings({ program }: { program: ProgramData }) {
  return <TargetEditor program={program} hunterHasUserAgent={Boolean(program.hunterHasUserAgent)}
    hunterHasUsername={Boolean(program.hunterHasUsername)} hasAi={Boolean(program.hasAi)} />;
}
