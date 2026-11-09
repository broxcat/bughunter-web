import { z } from 'zod';
import { reconReportV3NarrativeSchemaFor, type ReconReportV3Input } from '@/lib/reconReportV3';
import { structuredTransportSchemaFor } from '@/server/brain/transportSchema';

export function reconReportV3TransportSchemaFor(input: ReconReportV3Input, provider: string, model: string) {
  return structuredTransportSchemaFor(
    z.toJSONSchema(reconReportV3NarrativeSchemaFor(input), { reused: 'ref' }), provider, model,
  );
}
