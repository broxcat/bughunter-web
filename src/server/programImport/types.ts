
import type { ImportPlatform } from '@/lib/platformConnections';
import type { ProgramPreview, ProgramReference, RawAsset, Rule } from './normalize';

export type Reader = (path: string) => Promise<unknown>;
export type ImportedProgram = { name: string; id: string; assets?: RawAsset[]; rules?: Rule[] };

export interface ProgramImporter {
  readonly platform: ImportPlatform;
  detect(url: URL): ProgramReference | null;
  fetchProgram(reference: ProgramReference, read: Reader): Promise<ImportedProgram>;
  fetchScope(reference: ProgramReference, program: ImportedProgram, read: Reader): Promise<RawAsset[]>;
  fetchRules(reference: ProgramReference, program: ImportedProgram, read: Reader): Promise<Rule[]>;
  normalize(reference: ProgramReference, name: string, scope: RawAsset[], rules: Rule[]): ProgramPreview;
}

export class ImportUnavailable extends Error {
  constructor(readonly reason: 'manual' | 'connection_required' | 'rate_limited' | 'temporarily_unavailable', readonly retryAfter?: number) {
    super(reason);
  }
}

export const handlePattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
export const requireAvailable = (value: unknown): void => {
  if (!value) throw new ImportUnavailable('manual');
};
