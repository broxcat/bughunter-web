import Link from 'next/link';
import { auth } from '@/lib/auth';
import { hasHunterUsername } from '@/lib/programExecutionPolicy';
import { resolveDefaultAiConfig } from '@/server/brain/config';
import { requiredUserAgentSchema } from '@/lib/httpPolicy.mjs';
import TargetCreateForm from '@/components/TargetCreateForm';

export default async function NewTargetPage() {
  const userId = (await auth())?.user?.id;
  if (!userId) return null;
  const ai = await resolveDefaultAiConfig(userId, { includeApiKey: false }).catch(() => null);
  return <div className="space-y-5">
    <Link href="/targets" className="text-sm text-brand">← Targets</Link>
    <h1 className="text-2xl font-semibold">Create target</h1>
    <TargetCreateForm hunterHasUserAgent={requiredUserAgentSchema.safeParse(process.env.DEFAULT_USER_AGENT).success}
      hunterHasUsername={hasHunterUsername(process.env.HUNTER_USERNAME)} hasAi={Boolean(ai)} />
  </div>;
}
