// Opt-in, synthetic input only. No scanner, report, Settings or scope mutation.
import assert from 'node:assert/strict';
import {z} from 'zod';
import {prisma} from '@/lib/prisma';
import {resolveDefaultAiConfig} from '@/server/brain/config';
import {reportInput,reportBudget} from '@/lib/reconReport';
import {createReconReportV3Input,reconReportV3NarrativeSchemaFor} from '@/lib/reconReportV3';
const strip=(value:unknown,keys:string[]):unknown=>Array.isArray(value)?value.map(item=>strip(item,keys)):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([key])=>!keys.includes(key)).map(([key,item])=>[key,strip(item,keys)])):value;
async function main(){
  assert.equal(process.env.RECON_PAID_DIAGNOSTICS,'1','Explicit paid diagnostic opt-in required');
  assert(process.env.RECON_DIAGNOSTIC_USER_ID,'Select the configured owner explicitly');
  const config=await resolveDefaultAiConfig(process.env.RECON_DIAGNOSTIC_USER_ID);
  assert(config?.provider==='OPENROUTER'&&config.model==='google/gemini-3.6-flash','The configured default must be the requested OpenRouter/Gemini model');
  const evidence=[{id:'synthetic-endpoint',kind:'endpoint',value:{url:'https://example.test/login',method:'GET',statusCode:200},verification:'OBSERVED',scopeState:'IN_SCOPE'}];
  const input=createReconReportV3Input(reportInput({source:'asset'},evidence,reportBudget(8192)),evidence);
  const application=reconReportV3NarrativeSchemaFor(input),schema=z.toJSONSchema(application,{reused:'ref'});
  let requests=0;
  async function probe(variant:string,transport?:unknown){
    assert(++requests<=8,'Paid diagnostic request limit');
    const started=Date.now(),response=await fetch(config!.effectiveBaseUrl+'/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+config!.apiKey,'Content-Type':'application/json'},body:JSON.stringify({model:config!.model,messages:[{role:'user',content:'Return a concise synthetic reconnaissance narrative. Only evidence alias E001 exists. Do not invent facts. Return JSON matching the schema, using empty arrays when needed.'}],temperature:0,max_tokens:2048,...(transport?{response_format:{type:'json_schema',json_schema:{name:'recon_report',strict:true,schema:transport}},provider:{require_parameters:true}}:{})}),signal:AbortSignal.timeout(180000)});
    const body=await response.text();
    console.log(JSON.stringify({variant,httpStatus:response.status,invalidArgument:/\bINVALID_ARGUMENT\b/.test(body),durationMs:Date.now()-started}));
    return response.ok;
  }
  if(!await probe('A-plain'))return;
  await probe('B-minimal',{type:'object',properties:{ok:{type:'string'}},required:['ok'],additionalProperties:false});
  const array={type:'object',properties:{items:{type:'array',items:{type:'string'},maxItems:12}},required:['items'],additionalProperties:false};
  await probe('C-maxItems',array);await probe('C-without-maxItems',strip(array,['maxItems']));
  await probe('D-full',schema);
  if(await probe('E-without-maxItems',strip(schema,['maxItems'])))return;
  const bounds=['maxItems','minItems','maxLength','minLength'];
  if(await probe('F-without-bounds',strip(schema,bounds)))return;
  await probe('G-inline-without-bounds',strip(z.toJSONSchema(application,{reused:'inline'}),bounds));
}
try{await main();}catch(error){console.error(JSON.stringify({status:'FAIL',errorType:error instanceof Error?error.name:'Unknown'}));process.exitCode=1;}finally{await prisma.$disconnect();}
