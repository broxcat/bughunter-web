import {z} from 'zod';
import {isEvidenceRef} from '@/lib/research/hypotheses';
const id=z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,149}$/);
export const evidenceLinkSchema=z.discriminatedUnion('entity',[
 z.strictObject({entity:z.literal('hypothesis'),id,role:z.enum(['SUPPORTS','REFUTES','CONTEXT'])}),
 z.strictObject({entity:z.literal('finding'),id,role:z.enum(['SUPPORTS','REFUTES','CONTEXT'])}),
 z.strictObject({entity:z.literal('coverage'),id}),
]);
const common={description:z.string().trim().min(1).max(2000),link:evidenceLinkSchema.optional()};
export const evidenceCreateSchema=z.discriminatedUnion('kind',[
 z.strictObject({...common,kind:z.literal('RECON_ARTIFACT'),artifactId:id}),
 z.strictObject({...common,kind:z.enum(['BURP_REFERENCE','RESEARCH_EVIDENCE']),sessionId:id,ref:z.string().max(500).refine(isEvidenceRef)}),
 z.strictObject({...common,kind:z.literal('HTTP_REQUEST_RESPONSE'),sessionId:id.optional(),observedAt:z.iso.datetime({offset:true}),http:z.strictObject({method:z.enum(['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS','TRACE','CONNECT']),url:z.url().max(4096),requestExcerpt:z.string().max(2000).optional(),statusCode:z.number().int().min(100).max(599),contentType:z.string().max(150).optional(),responseExcerpt:z.string().max(2000).optional()})}),
]);
export type EvidenceCreate=z.infer<typeof evidenceCreateSchema>;
export type EvidenceLink=z.infer<typeof evidenceLinkSchema>;
export type EvidenceView={id:string;targetId:string;kind:string;description:string;createdAt:string;contentSha256:string|null;redactionStatus:string;provenance:Record<string,unknown>;metadata:Record<string,unknown>;relations?:Array<{entity:string;id:string;role?:string;revision?:number}>};
/** Narrow metadata scrubber. No raw HTTP headers or credential fields are accepted. */
export function redactEvidenceText(value:string):string{
 const sensitive=/authorization|cookies?|pass(?:word|wd)|secret|token|api[_-]?key|credential|session(?:id|token)?/i;
 const plain=(text:string)=>text.replace(/<input\b[^>]*(?:name|type|id)\s*=\s*["']?[^\s>"']*(?:password|token|csrf|secret|session)[^>]*>/gi,'[REDACTED FORM FIELD]').replace(/([a-z][a-z0-9+.-]*:\/\/)[^/\s"'<>@]+@/gi,'$1[REDACTED]@').replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g,'[REDACTED PRIVATE KEY]')
  .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,'[REDACTED EMAIL]')
  .replace(/\b(?:[a-z0-9_.-]*(?:authorization|cookies?|password|passwd|secret|token|api[_-]?key|credential|session(?:id|token)?)[a-z0-9_.-]*)["']?\s*[:=]\s*[^\r\n]+/gi,'[REDACTED CREDENTIAL]');
 const scrub=(v:unknown,depth=0):unknown=>depth>16?'[REDACTED NESTED DATA]':typeof v==='string'?plain(v):Array.isArray(v)?v.map(i=>scrub(i,depth+1)):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,item])=>[k,sensitive.test(k)?'[REDACTED CREDENTIAL]':scrub(item,depth+1)])):v;
 try{const parsed:unknown=JSON.parse(value);if(parsed&&typeof parsed==='object')return JSON.stringify(scrub(parsed));}catch{}
 return plain(value);
}
