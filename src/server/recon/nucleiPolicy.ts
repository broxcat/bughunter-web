import { join } from 'node:path';
export const RECON_TEMPLATE_IDS=['bughunter-recon-headers','bughunter-recon-auth','bughunter-recon-api','bughunter-recon-panel'] as const;
export const RECON_TEMPLATE_VERSION='2.0.0';
export const NUCLEI_RECON_DENY=['dos','fuzz','fuzzing','bruteforce','destructive','intrusive','headless','code','workflow','oast'] as const;
export const nucleiReconTemplates=(count:number)=>RECON_TEMPLATE_IDS.slice(0,Math.max(0,Math.min(4,count))).map(id=>join(process.cwd(),'src/server/recon/templates',id+'.yaml'));
export function nucleiTemplateAllowed(id:string,tags:string[],method:string,paths:string[]) {return RECON_TEMPLATE_IDS.includes(id as typeof RECON_TEMPLATE_IDS[number])&&method==='GET'&&paths.every(p=>p==='{{BaseURL}}')&&!tags.some(t=>NUCLEI_RECON_DENY.includes(t.toLowerCase() as typeof NUCLEI_RECON_DENY[number]));}
