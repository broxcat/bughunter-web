import {createHash} from 'node:crypto';
import {z} from 'zod';
import {COVERAGE_NOTICE,coverageCounts,coverageContext,coverageDocumentSchema,coverageMarkdown,type CoverageView} from '@/lib/research/coverage';
export function coverageInitialFiles(targetId:string,sessionId:string,view?:CoverageView){
 const data:CoverageView=view?coverageContext({...view,sessionId}):{version:1,targetId,planId:null,contextRunId:null,sessionId,notice:COVERAGE_NOTICE,truncated:false,entries:[],objectives:[],counts:coverageCounts([],0)};
 const text=JSON.stringify(data,null,2)+'\n',sha256=createHash('sha256').update(text).digest('hex');
 if(Buffer.byteLength(text)>512*1024)throw new Error('Coverage export limit');
 return{'research/coverage-current.json':JSON.stringify({version:1,sha256,jsonPath:`research/coverage-${sha256}.json`,markdownPath:`research/coverage-${sha256}.md`,notice:COVERAGE_NOTICE},null,2)+'\n',
 [`research/coverage-${sha256}.json`]:text,[`research/coverage-${sha256}.md`]:coverageMarkdown(data),
 'research/coverage.schema.json':JSON.stringify(z.toJSONSchema(coverageDocumentSchema),null,2)+'\n',
 'research/coverage-events.json':JSON.stringify({version:1,sessionId,events:[]},null,2)+'\n'};
}
export const isCoverageInput=(path:string)=>/^research\/coverage(?:-current|-[a-f0-9]{64}|\.schema)\.(?:json|md)$/.test(path);
