import {ReconReportV3ValidationError} from '@/lib/reconReportV3';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { redactObservationText } from '@/lib/observationSafety';
import { deterministicNarrative, projectRunNarrative, type RunNarrative } from '@/lib/reconRunNarrative';
import type { ReportFacts, ReconReportModel } from '@/lib/reconReportModel';

/** Read an already scheduled Settings-routed job for exactly this run. Never
 * enqueue, inspect a provider, decrypt credentials, or invoke a model on GET.
 * Existing ReconSummary fingerprint/automaticKey and bounded worker own cache
 * and generation. A failed optional read cannot break the factual report.
 */
export async function readRunNarrative(ownerId:string,facts:ReportFacts,model:ReconReportModel):Promise<RunNarrative> {
  try {
    const row=await prisma.reconSummary.findFirst({where:{targetReconRunId:facts.run.id,scopeAssetId:null,program:{ownerId}},orderBy:[{createdAt:'desc'},{id:'desc'}],select:{status:true,promptVersion:true,content:true,provider:true,model:true}});
    if(!row)return deterministicNarrative();
    if(['PENDING','RUNNING'].includes(row.status))return {state:'PENDING',highlights:[]};
    if(row.status!=='READY'||row.promptVersion!=='recon-report/3')return {state:'UNAVAILABLE',highlights:[]};
    const accepted=projectRunNarrative(row.content,facts,model);
    return {...accepted,provider:redactObservationText(row.provider),model:redactObservationText(row.model)};
  }catch(error){const codes:Record<string,string>={'Stale evidence':'STALE_EVIDENCE','Unknown persisted evidence reference':'UNKNOWN_EVIDENCE_REF','Unsupported conclusion':'UNSUPPORTED_CONCLUSION','Unsupported tool':'UNSUPPORTED_TOOL','Unsupported service':'UNSUPPORTED_SERVICE','Unsupported persona':'UNSUPPORTED_PERSONA'};const code=error instanceof ReconReportV3ValidationError?error.issues[0]?.code:error instanceof Error?codes[error.message]:undefined;logger.debug({component:'recon-run-narrative',runId:facts.run.id,code:code??'OPTIONAL_NARRATIVE_UNAVAILABLE'},'Optional run narrative omitted; deterministic report retained');return {state:'UNAVAILABLE',highlights:[]};}
}
