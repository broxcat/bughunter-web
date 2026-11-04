import { describe,it,expect,vi } from 'vitest';
import { BrainClient,BrainError } from '@/server/brain/client';
import { reportInput,reportBudget } from '@/lib/reconReport';
import { createReconReportV3Input,modelInputForReconReportV3 } from '@/lib/reconReportV3';
import { generateReconReportV3 } from '@/server/recon/ollamaReportV3';
import type { SummaryEvidence } from '@/lib/reconSummary';
function fixture(){
  const rows:SummaryEvidence[]=[
    {id:'scope',kind:'asset',value:{normalized:'https://app.example.test/',format:'URL',active:true,type:'WEB_APPLICATION'}},
    {id:'endpoint',kind:'endpoint',value:{url:'https://app.example.test/login',method:'GET',statusCode:200},scopeState:'IN_SCOPE',verification:'OBSERVED'},
    {id:'port',kind:'port',value:{hostname:'app.example.test',port:443,protocol:'tcp',state:'open'},scopeState:'IN_SCOPE',verification:'OBSERVED'},
    {id:'service',kind:'service',value:{hostname:'app.example.test',port:443,protocol:'tcp',name:'https'},scopeState:'IN_SCOPE',verification:'OBSERVED'},
  ];
  const input=createReconReportV3Input(reportInput({source:'asset'},rows,reportBudget(32768)),rows);
  const ref=Object.entries(input.aliases).find(([,id])=>id==='endpoint')![0];
  const narrative={title:'Recon assessment',attackSurfaceSummary:'Observed application surface.',sections:[{category:'webSurface',entries:[{text:'Review the supplied entry point.',confidence:'observed',evidenceRefs:[ref]}]}],notableObservations:[],researchHandoff:[],limitations:[]};
  const client=new BrainClient({provider:'OLLAMA',baseUrl:'http://unused.test',model:'settings-selected-model'});
  return{input,narrative,client};
}
describe('narrative-only Ollama report orchestration (mocked chat, no real inference)',()=>{
  it('constrains aliases and derives every factual field on the server',async()=>{
    const{input,narrative,client}=fixture(),before=JSON.stringify(input);
    const chat=vi.spyOn(client,'chat').mockResolvedValue(JSON.stringify(narrative));
    const report=await generateReconReportV3(client,input);
    expect(report.narrativeStatus).toBe('VALID');expect(report.narrative.webSurface[0].evidenceRefs).toEqual(['endpoint']);
    expect(report.narrative.webSurface[0].facts?.statusCodes).toEqual([200]);
    const schema=JSON.stringify(chat.mock.calls[0][2]?.format);
    expect(schema).not.toContain('"facts"');expect(schema).not.toContain('statusCodes');expect(schema).toContain('E001');
    expect(JSON.parse(chat.mock.calls[0][1])).toEqual(modelInputForReconReportV3(input));expect(JSON.stringify(input)).toBe(before);
  });
  it('omits one unsupported AI entry after one targeted correction and retains identical facts',async()=>{
    const{input,narrative,client}=fixture();
    narrative.sections[0].entries.push({...narrative.sections[0].entries[0],text:'Review https://invented.invalid/private.'});
    const chat=vi.spyOn(client,'chat').mockResolvedValue(JSON.stringify(narrative));
    const report=await generateReconReportV3(client,input);
    expect(chat).toHaveBeenCalledTimes(2);expect(report.narrativeStatus).toBe('RECOVERED');expect(report.narrative.webSurface).toHaveLength(1);
    expect(report.factual).toEqual(input.factual);expect(report.warnings.some(w=>w.code==='UNSUPPORTED_URL')).toBe(true);
    expect(chat.mock.calls[1][0]).toContain('UNSUPPORTED_URL');expect(chat.mock.calls[1][0]).not.toContain('invented.invalid');
    expect(JSON.stringify(report.narrative)).not.toContain('invented.invalid');
  });
  it('returns usable facts after two invalid JSON replies',async()=>{
    const{input,client}=fixture();const chat=vi.spyOn(client,'chat').mockResolvedValue('not json');
    const report=await generateReconReportV3(client,input);
    expect(chat).toHaveBeenCalledTimes(2);expect(report.narrativeFailure).toBe('FAILED_SCHEMA');expect(report.narrativeStatus).toBe('FACTUAL_ONLY');expect(report.factual).toEqual(input.factual);
  });
  it('returns usable facts when the configured provider is unavailable',async()=>{
    const{input,client}=fixture();const chat=vi.spyOn(client,'chat').mockRejectedValue(new BrainError('Unavailable','OLLAMA',503));
    const report=await generateReconReportV3(client,input);
    expect(chat).toHaveBeenCalledTimes(1);expect(report.narrativeFailure).toBe('FAILED_PROVIDER');expect(report.factual).toEqual(input.factual);
  });
  it('keeps a provider timeout distinct from malformed narrative',async()=>{
    const{input,client}=fixture();vi.spyOn(client,'chat').mockRejectedValue(new DOMException('Timeout','TimeoutError'));
    expect((await generateReconReportV3(client,input)).narrativeFailure).toBe('FAILED_PROVIDER');
  });
  it('propagates source cancellation rather than publishing fallback facts',async()=>{
    const{input,client}=fixture();const control=new AbortController();control.abort();const chat=vi.spyOn(client,'chat');
    await expect(generateReconReportV3(client,input,{signal:control.signal})).rejects.toThrow();expect(chat).not.toHaveBeenCalled();
  });
});
