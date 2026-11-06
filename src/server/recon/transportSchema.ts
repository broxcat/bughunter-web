import { z } from 'zod';
import { reconReportV3NarrativeSchemaFor, type ReconReportV3Input } from '@/lib/reconReportV3';

/** Transport compatibility only. Application validation remains authoritative.
 * Real A/B: complete Gemini schema 400; identical schema minus maxItems 200.
 */
export function reconReportV3TransportSchemaFor(input: ReconReportV3Input, provider: string, model: string) {
  const schema = z.toJSONSchema(reconReportV3NarrativeSchemaFor(input), { reused: 'ref' });
  const compatible = provider === 'OPENROUTER' && model.startsWith('google/gemini-');
  const removeMaxItems = (value: unknown): unknown => Array.isArray(value) ? value.map(removeMaxItems) : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'maxItems').map(([key, item]) => [key, removeMaxItems(item)])) : value;
  return { schema: compatible ? removeMaxItems(schema) as typeof schema : schema, variant: compatible ? 'gemini-without-maxItems' : 'native' };
}
