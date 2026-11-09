'use client';

import TargetEditor from './TargetEditor';

export default function TargetCreateForm(props: { hunterHasUserAgent: boolean; hunterHasUsername: boolean; hasAi: boolean }) {
  return <TargetEditor {...props} />;
}
