import {describe,it,expect} from 'vitest';
import {reportInput,reportBudget} from '@/lib/reconReport';
import {createReconReportV3Input,reconReportV3NarrativeSchemaFor,validateReconReportV3} from '@/lib/reconReportV3';
import {reconReportV3TransportSchemaFor} from '@/server/recon/transportSchema';
describe('Recon transport compatibility',()=>{it('removes only maxItems for OpenRouter Gemini while preserving strict application bounds',()=>{
 const input=createReconReportV3Input(reportInput({},[],reportBudget(8192)),[]);
 const native=reconReportV3TransportSchemaFor(input,'OLLAMA','gpt-oss:20b');
 const gemini=reconReportV3TransportSchemaFor(input,'OPENROUTER','google/gemini-3.6-flash');
 expect(JSON.stringify(native.schema)).toContain('maxItems');expect(JSON.stringify(gemini.schema)).not.toContain('maxItems');
 for(const key of ['minLength','maxLength','$ref','additionalProperties'])expect(JSON.stringify(gemini.schema)).toContain(key);
 expect(reconReportV3NarrativeSchemaFor(input).safeParse({title:'x',attackSurfaceSummary:'x',sections:[],notableObservations:[],limitations:Array(21).fill('x'),researchHandoff:[]}).success).toBe(false);
 expect(()=>validateReconReportV3(JSON.stringify({title:'x',attackSurfaceSummary:'x',sections:[],notableObservations:[],limitations:Array(21).fill('x'),researchHandoff:[]}),input)).toThrow();
 expect(reconReportV3TransportSchemaFor(input,'OPENROUTER','other-model').schema).toEqual(native.schema);
});});
