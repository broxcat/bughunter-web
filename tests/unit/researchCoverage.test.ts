import {describe,it,expect} from 'vitest';
import {coverageRecordSchema,coverageDocumentSchema,coverageCounts,coverageContext,coverageMarkdown,COVERAGE_NOTICE,type CoverageEntry} from '@/lib/research/coverage';
import {coverageInitialFiles,isCoverageInput} from '@/server/research/coverageFiles';
const base={testKey:'access-check',eventKey:'ab7c72df-2222-4333-a444-555555555555',sessionId:'session',planItemId:'item',surface:'https://app.example.test/login',method:'GET',contextKey:'ANONYMOUS',comparisonKey:null,state:'COVERED_NO_ISSUE_OBSERVED',expectedRevision:0,action:'Tested without a session',result:'Authentication required',evidence:[{ref:'requests/control.json',summary:'Control response'}],performedAt:'2026-11-06T12:00:00Z'};
describe('Research Coverage contract',()=>{
 it('requires evidence, explicit dimensions, result and a strict bounded structured record',()=>{
  expect(coverageRecordSchema.safeParse(base).success).toBe(true);
  for(const extra of [{evidence:[]},{method:undefined},{contextKey:''},{result:''},{expectedRevision:-1},{rawTerminal:'GET returned 403'},{state:'SAFE'},{evidence:[{ref:'../../secret',summary:'No'}]}])expect(coverageRecordSchema.safeParse({...base,...extra}).success).toBe(false);
  expect(coverageRecordSchema.safeParse({...base,state:'NOT_TESTED',evidence:[]}).success).toBe(true);
 });
 it('requires distinct comparison contexts and real relationship references',()=>{
  for(const extra of [{comparisonKey:'ANONYMOUS'},{state:'FINDING'},{state:'HYPOTHESIS_OPEN'},{hypothesisTestId:'T-001'}])expect(coverageRecordSchema.safeParse({...base,...extra}).success).toBe(false);
  expect(coverageRecordSchema.safeParse({...base,contextKey:'AUTH_A',comparisonKey:'AUTH_B'}).success).toBe(true);
  expect(coverageDocumentSchema.safeParse({version:1,sessionId:'session',events:[base]}).success).toBe(true);
 });
 it('keeps negative results explicit and never promises safety',()=>{
  const entry={id:'coverage',revision:1,method:'GET',surface:base.surface,contextLabel:'User A',comparisonLabel:'User B',state:'COVERED_NO_ISSUE_OBSERVED',events:[{result:'403; hypothesis rejected'}]} as CoverageEntry;
  const view={version:1 as const,targetId:'target',planId:'plan',contextRunId:'scan',sessionId:'session',notice:COVERAGE_NOTICE,truncated:false,entries:[entry],objectives:[],counts:coverageCounts([entry],1)};
  expect(view.counts.COVERED_NO_ISSUE_OBSERVED).toBe(1);expect(view.counts.NOT_TESTED).toBe(1);
  const text=coverageMarkdown(view);for(const expected of ['Already covered','In progress','Untested','Needs retest','Do not repeat','403; hypothesis rejected','is not SAFE'])expect(text).toContain(expected);
 });
 it('separates writable structured input from common read-only agent snapshots',()=>{
  const files=coverageInitialFiles('target','session');expect(JSON.parse(files['research/coverage-events.json']).events).toEqual([]);
  const ref=JSON.parse(files['research/coverage-current.json']);expect(files[ref.jsonPath]).toBeTruthy();expect(files[ref.markdownPath]).toContain('Do not repeat');
  for(const path of Object.keys(files).filter(p=>p!=='research/coverage-events.json'))expect(isCoverageInput(path)).toBe(true);
  expect(isCoverageInput('research/coverage-events.json')).toBe(false);
 });
 it('bounds agent context without erasing history, changing counts or mutating the source',()=>{
  const view={version:1 as const,targetId:'target',planId:'plan',contextRunId:'scan',sessionId:'session',notice:COVERAGE_NOTICE,truncated:false,entries:Array.from({length:500},(_,i)=>({id:String(i),events:[{result:'x'.repeat(4000),createdAt:'2026-11-06T00:00:00Z'}]} as CoverageEntry)),objectives:[],counts:coverageCounts([],0)};
  const before=JSON.stringify(view),context=coverageContext(view);expect(context.truncated).toBe(true);expect(context.entries.length).toBeLessThan(500);expect(new TextEncoder().encode(JSON.stringify(context)).byteLength).toBeLessThan(192*1024);expect(context.counts).toEqual(view.counts);expect(JSON.stringify(view)).toBe(before);
 });

});
