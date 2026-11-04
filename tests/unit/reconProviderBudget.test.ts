import{describe,it,expect,vi}from'vitest';
const inspect=vi.hoisted(()=>vi.fn(async()=>({contextTokens:32768,detected:true})));
vi.mock('@/server/recon/ollamaReport',()=>({inspectOllamaReportModel:inspect}));
import{resolveReconReportBudget}from'@/server/recon/reportProvider';
describe('provider-specific report budget',()=>{
  it('uses Ollama metadata only for Ollama',async()=>{expect(await resolveReconReportBudget({provider:'OLLAMA',model:'selected-local',effectiveBaseUrl:'http://local.test'})).toMatchObject({contextTokens:32768});expect(inspect).toHaveBeenLastCalledWith('http://local.test','selected-local',undefined);});
  it.each(['OPENROUTER','OPENAI','GROQ']as const)('uses conservative bounds without contacting Ollama for %s',async provider=>{inspect.mockClear();const budget=await resolveReconReportBudget({provider,model:'selected-api-model',effectiveBaseUrl:'https://api.test/v1'});expect(budget.contextTokens).toBe(8192);expect(budget.detected).toBe(false);expect(budget.think).toBeUndefined();expect(inspect).not.toHaveBeenCalled();});
});
