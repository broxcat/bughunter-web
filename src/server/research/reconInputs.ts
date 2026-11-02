import { assetEvidenceSchema } from '@/server/recon/assetEvidence';
import type { ReconRun } from './reconContext';
/** Flatten per-host derivatives under their real scan ID, never invent source scans. */
export function expandAssetReconRuns(runs: Array<ReconRun & { assetResults?: unknown }>): ReconRun[] {
  return runs.flatMap(run => {
    const parsed = assetEvidenceSchema.safeParse(run.assetResults);
    if (!parsed.success) return [run];
    return [...parsed.data.hosts.map(host => ({ ...run, target: { host: host.hostname }, reconCorpus: host.corpus,
      logs: [], discoveries: [], _count: { discoveries: 0, logs: 0 },
      corpusReference: `ScanRun:${run.id}:assetResults:${host.hostname}:corpus`,
      httpObservations: host.http, dnsAddresses: host.dns, portObservations: host.ports, tlsObservation: host.tls,
    })), { ...run, reconCorpus: null, discoveries: run.discoveries, logs: [], _count: { discoveries: run._count?.discoveries ?? run.discoveries.length, logs: 0 }, partialCoverage: parsed.data.bounded, historicalUrls: parsed.data.historicalUrls }];
  });
}
