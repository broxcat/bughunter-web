export const RECON_STAGES = ['Discovery', 'DNS', 'HTTP probing', 'Ports', 'Technology detection', 'Crawling', 'Endpoint extraction', 'Parameter extraction', 'JavaScript analysis', 'Normalization', 'Research Context'] as const;
export type ReconStage = typeof RECON_STAGES[number];
export const assetReconPlan = (asset: { format: string; type: string }) => ({
  wildcard: asset.format === 'WILDCARD_DOMAIN',
  api: asset.type === 'API',
  // External crawlers cannot guarantee a URL path boundary on every request.
  guardedHttpOnly: asset.format === 'URL',
  maxHosts: asset.format === 'WILDCARD_DOMAIN' ? 8 : 1,
  documentation: asset.type === 'API' ? ['openapi.json', 'swagger.json', 'api-docs', 'graphql'] : [],
});
