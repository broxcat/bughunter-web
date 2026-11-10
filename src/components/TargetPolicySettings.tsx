'use client';

import TargetEditor from './TargetEditor';
import type { ProgramData } from '@/lib/targetFormData';

export default function TargetPolicySettings({ program }: { program: ProgramData }) {
  return <TargetEditor program={program} hasAi={Boolean(program.hasAi)} />;
}
