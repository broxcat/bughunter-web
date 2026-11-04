import type { AiProviderName } from '../brain/providers';
import { reportBudget } from '@/lib/reconReport';
import { inspectOllamaReportModel } from './ollamaReport';

/** Provider metadata must never be inferred from another provider's model.
 * API providers use a conservative application envelope when their context
 * metadata is not available; native JSON decoding remains provider-specific. */
export async function resolveReconReportBudget(config: {provider:AiProviderName;model:string;effectiveBaseUrl:string},signal?:AbortSignal) {
  if(config.provider==='OLLAMA')return inspectOllamaReportModel(config.effectiveBaseUrl,config.model,signal);
  signal?.throwIfAborted();
  return reportBudget();
}
