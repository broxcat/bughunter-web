type Schema = Record<string, unknown>;

/** OpenRouter's Gemini endpoints rejected maxItems on the full Recon schema.
 * Relax only the transport keyword. Callers still validate the full Zod schema. */
export function structuredTransportSchemaFor(schema: Schema, provider: string, model: string) {
  if (provider !== 'OPENROUTER' || !model.startsWith('google/gemini-')) {
    return { schema, variant: 'native' as const };
  }

  const withoutMaxItems = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(withoutMaxItems);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => key !== 'maxItems')
      .map(([key, child]) => [key, withoutMaxItems(child)]));
  };

  return { schema: withoutMaxItems(schema) as Schema, variant: 'gemini-without-maxItems' as const };
}
