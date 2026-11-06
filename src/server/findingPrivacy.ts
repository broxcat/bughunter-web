import {redactObservationText} from '@/lib/observationSafety';
import {redactEvidenceText} from '@/lib/evidenceVault';
/** Shared export boundary, including historical rows. No historical SQL rewrite. */
export function safeFindingText(value:string){return redactEvidenceText(redactObservationText(value)).replace(/\b(?:DATABASE_URL|REDIS_URL|AUTH_SECRET|CREDENTIALS_ENCRYPTION_KEY|\w+cipher)\s*["']?\s*[:= ]\s*[^\r\n]+/gi,'[REDACTED]').replace(/[\x00-\x08\x0b-\x1f\x7f]/g,'');}
export function safeFindingField<T extends string|null|undefined>(value:T):T{return(typeof value==='string'?safeFindingText(value):value) as T;}
export function publicFinding<T extends object>(row:T):T{
 const result={...row} as Record<string,unknown>;
 for(const key of ['title','description','location','evidence','impact','remediation','killedReason'])if(typeof result[key]==='string')result[key]=safeFindingText(result[key] as string);
 for(const key of ['reviewEvidence','huntMetadata','submission'])if(result[key]!=null)try{result[key]=JSON.parse(safeFindingText(JSON.stringify(result[key])));}catch{result[key]={redacted:true};}
 return result as T;
}
