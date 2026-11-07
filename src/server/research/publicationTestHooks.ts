// Explicit dependency injection for disposable Vitest fixtures only. No HTTP,
// environment delay switch, provider call or production control surface.
import { AsyncLocalStorage } from 'node:async_hooks';
export type PublicationPhase = 'PUBLICATION_BEGIN' | 'TEMP_DURABLE' | 'BEFORE_RENAME' | 'AFTER_RENAME' | 'BEFORE_READY' | 'AFTER_READY' | 'ACTIVATION_BEGIN' | 'AFTER_ACTIVATION' | 'FILE_DURABLE' | 'SQL_BEGIN' | 'SQL_END' | 'READY_IN_TRANSACTION';
type Hooks = Partial<Record<PublicationPhase, () => Promise<void>>>;
const hooks = new AsyncLocalStorage<Hooks>();
export function withPublicationTestHooks<T>(value: Hooks, work: () => Promise<T>): Promise<T> {
  if (process.env.NODE_ENV !== 'test' || !process.env.TEST_DATABASE_URL) throw new Error('Disposable publication test context required');
  return hooks.run(value, work);
}
export async function publicationCheckpoint(phase: PublicationPhase) {
  await hooks.getStore()?.[phase]?.();
}
