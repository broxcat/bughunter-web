import { createHash } from 'node:crypto';
import { isSafeReadUrl, redactObservationText } from './observationSafety';
import { deriveSurfaceVisibility, safeSurfaceUrl, type SafeAuthSurface } from './authenticatedRecon';
import { classifyReconUrl, type ReconArtifactData } from './reconArtifacts';
import type { ReconAssetGraph } from './reconGraph';
import type { AssessmentMode } from './assessment';
import { normalizeFqdn } from './bountyProgram';

export const RESEARCH_PLAN_VERSION = 'research-plan/1' as const;
export const RESEARCH_CATEGORIES = ['AUTHORIZATION','AUTHENTICATION','SESSION_MANAGEMENT','API','API_VERSIONING','GRAPHQL','FILE_UPLOAD','SERVER_SIDE_REQUEST','REDIRECT_HANDLING','BUSINESS_LOGIC','PRIVILEGED_FUNCTIONS','ACCOUNT_LIFECYCLE','TENANT_ISOLATION','INPUT_HANDLING'] as const;
export type ResearchCategory = typeof RESEARCH_CATEGORIES[number];
export type ResearchPriority = 'HIGH' | 'MEDIUM' | 'LOW';
export type ResearchSignal = { code: string; description: string; evidenceRefs: string[] };
export type ResearchContextRef = { contextKey: string; label: string; persona?: string };
export type ResearchSurfaceRef = { url: string; method?: string; pattern?: string; scopeAssetId?: string; requestable?: false };
export type ResearchPlanItem = {
  stableKey: string; category: ResearchCategory; priority: ResearchPriority; title: string; objective: string;
  rationale: string; methodology: string[]; surfaceRefs: ResearchSurfaceRef[]; evidenceRefs: string[];
  contextRefs: ResearchContextRef[]; runtimeSignals: ResearchSignal[]; sourceSignals: []; sourceEvidenceRefs: [];
  score: number; evidenceStrength: 'STRONG' | 'MODERATE' | 'LIMITED'; status: 'READY' | 'NOT_APPLICABLE_BY_PROGRAM';
};
export type ResearchPlanDecision = { scopeAssetId: string; category?: ResearchCategory; status: 'NOT_APPLICABLE_BY_PROGRAM' | 'OUT_OF_SCOPE' | 'NO_RUNTIME_SIGNAL' | 'ITEM_LIMIT' | 'STATIC_ASSET_OMITTED' | 'INVALID_EVIDENCE'; reason: string; evidenceRefs: string[] };
export type ResearchPlan = {
  version: typeof RESEARCH_PLAN_VERSION; programId: string; items: ResearchPlanItem[]; decisions: ResearchPlanDecision[];
  limitations: string[]; notes: string[]; sourceContentAvailable: false; sourceAnalysisPerformed: false;
};
export type ResearchProgramExclusion = { category: ResearchCategory; reason: string; reference?: string };
export type ResearchPlanAssetInput = {
  scopeAsset: { id: string; normalizedValue: string; format: string; type: string; assetValue: string; active: boolean };
  scanRunId: string; artifacts: ReconArtifactData[]; authenticatedSurfaces?: SafeAuthSurface[]; graph?: ReconAssetGraph;
  newArtifactIds?: string[];
};
export type ResearchPlanInput = {
  programId: string; assets: ResearchPlanAssetInput[]; assessmentMode?: AssessmentMode | null;
  inScope: (value: string, scopeAssetId: string) => boolean;
  programExclusions?: ResearchProgramExclusion[]; programPriorityCategories?: ResearchCategory[]; inputTruncated?: boolean;
};

type CategoryDefinition = { title: string; objective: string; score: number; aliases: string[]; checks: string[] };
export const RESEARCH_CATEGORY_REGISTRY: Record<ResearchCategory, CategoryDefinition> = {
  AUTHORIZATION: { title:'Authorization boundaries', objective:'Compare observed access to owned resources across explicitly authorized test contexts.',score:24,aliases:['authorization','access control','broken access control','idor','bola'],checks:['Establish the expected access policy for owned test resources.','Compare the same recorded surface using authorized test identities.','Preserve request references; a visibility difference alone does not prove broken authorization.'] },
  AUTHENTICATION: { title:'Authentication entry points', objective:'Review the observed authentication flow and its documented trust boundaries.',score:18,aliases:['authentication','authentication bypass'],checks:['Identify the observed login or authentication challenge.','Use authorized test accounts and establish expected behavior.','Keep authentication observations separate from confirmed security impact.'] },
  SESSION_MANAGEMENT: { title:'Session behavior', objective:'Review how observed authenticated contexts and session metadata relate to the application boundary.',score:14,aliases:['session management','sessions'],checks:['Review available session metadata without exporting session values.','Use a verified test session and document expected lifetime and identity.','Stop if the session expires; do not silently switch to anonymous access.'] },
  API: { title:'API entry points', objective:'Map the observed or specification-declared API contracts before focused manual investigation.',score:12,aliases:['api','apis','api security'],checks:['Distinguish observed responses from specification declarations.','Review the recorded methods and named parameters.','Use owned test objects and avoid destructive or undocumented operations.'] },
  API_VERSIONING: { title:'API version boundaries', objective:'Review the explicitly observed API version surface without assuming versions share behavior.',score:12,aliases:['api versioning','versioned apis'],checks:['Verify the recorded versioned route.','Compare only versions that are actually evidenced and authorized.','Document differences without inferring that an older version is vulnerable.'] },
  GRAPHQL: { title:'GraphQL surface', objective:'Review the observed GraphQL indicator and verify the actual endpoint or declared schema boundary before testing.',score:18,aliases:['graphql','graphql security'],checks:['Correlate the indicator with supplied routes, specifications or recorded operations before assuming an endpoint.','Review supplied schema or observed operation metadata only.','Avoid mutations, bulk operations and resource exhaustion tests.'] },
  FILE_UPLOAD: { title:'Upload surface', objective:'Review the documented purpose and authorization of the observed upload interface.',score:20,aliases:['file upload','file uploads','uploads'],checks:['Verify the observed upload interface and expected file policy.','Use only authorized, inert test material if later testing is approved.','Do not infer executable upload or unsafe storage from a route name.'] },
  SERVER_SIDE_REQUEST: { title:'Server-side URL inputs', objective:'Determine whether evidenced URL-like inputs represent a server-side request boundary.',score:22,aliases:['server side request','server side request forgery','ssrf'],checks:['Establish the documented purpose of the observed URL-like parameter.','Determine whether any request is performed server-side using authorized evidence.','Do not contact internal, metadata or third-party destinations outside explicit authorization.'] },
  REDIRECT_HANDLING: { title:'Redirect destinations', objective:'Review observed redirects or named destination inputs against the expected navigation policy.',score:16,aliases:['redirect handling','redirects','open redirect','open redirects'],checks:['Review the recorded redirect or destination parameter.','Distinguish navigation behavior from a security defect.','Do not follow an external destination without its separate authorization.'] },
  BUSINESS_LOGIC: { title:'Business workflow boundaries', objective:'Understand the observed business workflow and its intended invariants before manual research.',score:18,aliases:['business logic','business logic security'],checks:['Document the intended workflow using supplied evidence.','Use owned records and reversible test cases within program rules.','Avoid payments, irreversible changes or effects on other users.'] },
  PRIVILEGED_FUNCTIONS: { title:'Privileged interface boundaries', objective:'Review the expected authorization of administrative-looking surfaces that Recon actually recorded.',score:20,aliases:['privileged functions','administrative functions','admin functions'],checks:['Confirm the purpose of the observed administrative-looking route.','Establish the expected roles using authorized test accounts.','A route name or an ordinary access denial does not demonstrate a vulnerability.'] },
  ACCOUNT_LIFECYCLE: { title:'Account lifecycle', objective:'Review the observed account creation, recovery or identity-change flow without assuming a weakness.',score:18,aliases:['account lifecycle','account lifecycle security'],checks:['Identify the exact lifecycle routes recorded in Recon.','Use owned accounts and establish the expected confirmation flow.','Avoid sending recovery messages or changing account state without explicit approval.'] },
  TENANT_ISOLATION: { title:'Tenant boundaries', objective:'Review explicit tenant identifiers or operator-declared tenant contexts against the expected ownership policy.',score:24,aliases:['tenant isolation','cross tenant access','tenant boundaries'],checks:['Establish tenant ownership using authorized test accounts.','Compare only recorded resources owned by those accounts.','Different visibility does not itself prove cross-tenant access.'] },
  INPUT_HANDLING: { title:'Observed input boundaries', objective:'Review evidenced parameter or form-field names and their documented handling.',score:12,aliases:['input handling','input validation','all injection issues'],checks:['Verify the recorded input and its intended data type.','Trace it using supplied request evidence before choosing any manual test.','Do not infer injection or execute payloads from parameter names alone.'] },
};
const unique = (values: string[]) => [...new Set(values)].sort();
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const validId = (value: unknown): value is string => typeof value==='string'&&/^[A-Za-z0-9_-]{1,150}$/.test(value);
const text = (value: string, max=300) => redactObservationText(value).replace(/[\x00-\x1f\x7f]/g,' ').slice(0,max);
const aliases = new Map(RESEARCH_CATEGORIES.flatMap(category=>[category,...RESEARCH_CATEGORY_REGISTRY[category].aliases].map(alias=>[alias.toLowerCase().replaceAll('_',' ').replaceAll('-',' ').replace(/\s+/g,' ').trim(),category] as const)));
const policyCategory=(value:string)=>aliases.get(value.trim().replace(/^[-*•]\s*/,'').replace(/[.:;]+$/,'').toLowerCase().replaceAll('_',' ').replaceAll('-',' ').replace(/\s+/g,' ').trim());
/** Program fields are a separate authority input. Conditional exclusions such
 * as self-XSS do not exclude a whole category; remote Recon text is never read. */
export function parseProgramResearchExclusions(nonQualifying: string[], rulesOfEngagement: string[] = [], qualifying: string[] = []) {
  const exclusions:ResearchProgramExclusion[]=[],priorityCategories:ResearchCategory[]=[],limitations:string[]=[];
  let unresolved=0;
  for(const [index,line]of nonQualifying.entries()){
    const category=policyCategory(line);
    if(category)exclusions.push({category,reason:'Explicit non-qualifying program category.',reference:`program:nonQualifying:${index}`});else if(line.trim())unresolved++;
  }
  for(const [index,line]of rulesOfEngagement.entries()){
    const subject=/^\s*(?:(?:do not|never) (?:test|investigate)|(?:testing|investigating) (?:of )?(.+?) (?:is prohibited|is not allowed)|excluded\s*:)\s*(.*?)\s*[.!]?\s*$/i.exec(line);
    const category=subject?policyCategory(subject[1]||subject[2]):undefined;
    if(category)exclusions.push({category,reason:'Explicit rules-of-engagement exclusion.',reference:`program:rulesOfEngagement:${index}`});
    else if(line.trim())unresolved++;
  }
  for(const line of qualifying){const category=policyCategory(line);if(category)priorityCategories.push(category);}
  if(unresolved)limitations.push('Some program policy clauses require manual review; conditional or ambiguous language was not expanded into category-wide exclusions.');
  return{exclusions:[...new Map(exclusions.sort((a,b)=>a.category.localeCompare(b.category)||String(a.reference).localeCompare(String(b.reference))).map(row=>[row.category,row])).values()],priorityCategories:unique(priorityCategories) as ResearchCategory[],limitations};
}

type Surface = {
  identity:string;url:string;methods:Set<string>;pattern?:string;requestable:boolean;refs:Set<string>;signals:Map<string,ResearchSignal>;
  contexts:Map<string,ResearchContextRef>;verified:boolean;declared:boolean;parameterNames:Set<string>;contextDifferential:boolean;
};
const contextPersonas=new Set(['ADMIN','ADMINISTRATOR','MANAGER','USER','STANDARD_USER','CUSTOMER','VENDOR','TENANT_A','TENANT_B','READ_ONLY','READONLY','EDITOR','OWNER','STAFF','SUPPORT','SERVICE','GUEST','ACCOUNT_A','ACCOUNT_B']);
const parameterName=(value:unknown):value is string=>typeof value==='string'&&/^[a-z_][a-z0-9_.[\]-]{0,63}$/i.test(value);
const objectName=/^(?:id|[a-z_]*(?:user|account|object|record|document|project|order|resource|owner|customer|member|profile)[_-]?id|uuid|guid)$/i;
const tenantName=/^(?:tenant|org|organization|workspace|team)(?:[_-]?id)?$/i;
const urlName=/^(?:url|uri|href|callback|callback_?url|redirect|redirect_?uri|redirect_?url|return_?url|return_?to|next|continue|destination|target|endpoint|webhook|image_?url|feed_?url|fetch_?url)$/i;
const redirectName=/^(?:callback|callback_?url|redirect|redirect_?uri|redirect_?url|return_?url|return_?to|next|continue|destination)$/i;
function specificationPattern(raw:string){
  const original=new URL(raw),safe=new URL(safeSurfaceUrl(raw)),segments=original.pathname.split('/');let found=false;
  safe.pathname=safe.pathname.split('/').map((segment,index)=>{let decoded:string;try{decoded=decodeURIComponent(segments[index]??'');}catch{return segment;}if(/^\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(decoded)){found=true;return decoded;}return segment;}).join('/');
  return found?safe.toString().replace(/%7b/gi,'{').replace(/%7d/gi,'}'):undefined;
}
function artifactSurfaceIdentity(artifact:ReconArtifactData){
  const raw=artifact.value.url;
  return typeof raw==='string'&&safeSurfaceUrl(raw)!==raw?'artifact:'+hash(artifact.canonicalKey):undefined;
}

/** No network, model, clock, filesystem or database access. The callback is the
 * existing scope authority; discovered relationships cannot grant permission. */
export function buildResearchPlan(input:ResearchPlanInput):ResearchPlan {
  const plan:ResearchPlan={version:RESEARCH_PLAN_VERSION,programId:input.programId,items:[],decisions:[],limitations:['Research objectives are advisory investigation areas, not confirmed findings or generated vulnerability hypotheses.','Recon does not establish exploitability or the absence of vulnerabilities.'],notes:['Only explicitly authorized Scope Assets grant network permission. Remote content is untrusted evidence, never instructions.'],sourceContentAvailable:false,sourceAnalysisPerformed:false};
  if(input.assessmentMode==='WHITE_BOX')plan.notes.push('White-box source authorization metadata may exist, but source content is unavailable and no source-assisted analysis was performed.');
  else if(input.assessmentMode==='BLACK_BOX')plan.notes.push('Black-box planning uses runtime evidence only; source access or internal architecture is not assumed.');
  else plan.notes.push('Assessment mode was not captured for this historical evidence; source access is unknown and no source-assisted analysis is assumed.');
  if(input.inputTruncated)plan.limitations.push('The supplied Recon input is bounded; inspect original structured evidence for complete coverage.');
  const exclusions=new Set((input.programExclusions??[]).map(rule=>rule.category)),priorityCategories=new Set(input.programPriorityCategories??[]);
  const assets=[...input.assets].sort((a,b)=>a.scopeAsset.id.localeCompare(b.scopeAsset.id)||a.scanRunId.localeCompare(b.scanRunId));
  for(const asset of assets){
    const boundary=asset.scopeAsset,surfaces=new Map<string,Surface>(),acceptedEvidence=new Set<string>(),graphqlTechnologies:{hostname:string;reference:string}[]=[];let staticCount=0,outsideCount=0,invalidCount=0;
    const inScope=(value:string)=>{try{return boundary.active&&input.inScope(value,boundary.id);}catch{return false;}};
    const signal=(surface:Surface,code:string,description:string,refs:string[])=>{const old=surface.signals.get(code);surface.signals.set(code,{code,description,evidenceRefs:unique([...(old?.evidenceRefs??[]),...refs])});};
    const surface=(raw:string,method:string|undefined,refs:string[],options:{identity?:string;verified?:boolean;declared?:boolean;requestable?:boolean;pattern?:string}={})=>{
      if(!inScope(raw)){outsideCount++;return null;}
      let url:string;try{url=safeSurfaceUrl(raw);if(classifyReconUrl(url)==='static'){staticCount++;return null;}}catch{invalidCount++;return null;}
      const httpMethod=method&&/^(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)$/.test(method)?method:undefined;
      const identity=options.identity??url;
      let row=surfaces.get(identity);
      if(!row){row={identity,url,methods:new Set(),...(options.pattern?{pattern:options.pattern}:{}),requestable:options.requestable!==false&&url===raw&&isSafeReadUrl(raw)&&(!httpMethod||['GET','HEAD'].includes(httpMethod)),refs:new Set(),signals:new Map(),contexts:new Map(),verified:false,declared:false,parameterNames:new Set(),contextDifferential:false};surfaces.set(identity,row);}
      if(httpMethod)row.methods.add(httpMethod);
      if(options.pattern){row.pattern=options.pattern;row.requestable=false;}
      refs.forEach(ref=>row!.refs.add(ref));row.verified||=options.verified===true;row.declared||=options.declared===true;row.requestable&&=options.requestable!==false;
      return row;
    };
    const artifacts=[...asset.artifacts].sort((a,b)=>(a.id??'').localeCompare(b.id??'')||a.canonicalKey.localeCompare(b.canonicalKey));
    if(artifacts.length>5000)plan.limitations.push(`Scope Asset ${boundary.id}: artifact preprocessing limit reached; remaining evidence is available in Recon.`);
    for(const artifact of artifacts.slice(0,5000)){
      if(!validId(artifact.id)){invalidCount++;continue;}
      if(artifact.scopeState!=='IN_SCOPE'){outsideCount++;continue;}
      const value=artifact.value,refs=['ReconArtifact:'+artifact.id];
      if(artifact.kind==='technology'&&typeof value.name==='string'&&value.name.trim().toLowerCase()==='graphql'&&typeof value.hostname==='string'){
        try{graphqlTechnologies.push({hostname:normalizeFqdn(value.hostname),reference:refs[0]});}catch{invalidCount++;}
      }
      if(typeof value.url!=='string')continue;
      if(value.baselineEquivalent===true||value.routeConfidence==='UNSTABLE_BASELINE'||['content-baseline','content-discovery-calibration','unverified-http-response'].includes(String(value.type??''))||value.responseClass==='UNAVAILABLE'||typeof value.statusCode==='number'&&([0,404,410,429].includes(value.statusCode)||value.statusCode>=500))continue;
      try{if(/\/__bughunter_/i.test(new URL(value.url).pathname))continue;}catch{invalidCount++;continue;}
      const declared=value.type==='api-specification'&&typeof value.declaredMethod==='string';
      const method=typeof value.method==='string'?value.method.toUpperCase():typeof value.declaredMethod==='string'?value.declaredMethod.toUpperCase():undefined;
      const pattern=declared?specificationPattern(value.url):undefined;
      const row=surface(value.url,method,refs,{identity:artifactSurfaceIdentity(artifact),verified:artifact.verification==='OBSERVED'&&typeof value.statusCode==='number'&&value.statusCode>=200&&value.statusCode<400,declared,requestable:value.safeForActiveReview!==false,...(pattern?{pattern}:{})});
      if(!row)continue;
      refs.forEach(ref=>acceptedEvidence.add(ref));
      if(asset.newArtifactIds?.includes(artifact.id))signal(row,'NEW_SURFACE','This referenced artifact is new in the supplied Recon comparison; coverage differences do not prove that the surface itself is newly exposed.',refs);
      const pathname=new URL(row.url).pathname;
      if(artifact.kind==='parameter'&&parameterName(value.name)){row.parameterNames.add(value.name);signal(row,'INPUT_PARAMETER','A parameter name was recorded in structured Recon evidence.',refs);}
      if(value.type==='observed-form'){signal(row,'FORM_METADATA','A form method or named fields were observed; form submission was not performed.',refs);}
      if(artifact.kind==='api-surface'||declared||/^application\/(?:[^;]+\+)?json(?:;|$)/i.test(String(value.contentType??''))||/\/(?:api|v\d+)(?:\/|$)/i.test(pathname))signal(row,declared?'API_SPECIFICATION':'API_SURFACE',declared?'The supplied specification declares this API route and method; accessibility is not implied.':'Structured Recon records an API-looking route or JSON response.',refs);
      if(artifact.kind==='auth-surface'||[401].includes(Number(value.statusCode))||/\/(?:login|signin|sign-in|auth|oauth|sso)(?:\/|$)/i.test(pathname))signal(row,'AUTHENTICATION_SURFACE','An authentication-looking route or HTTP authentication boundary was recorded.',refs);
      if(value.type==='cookie-metadata')signal(row,'COOKIE_METADATA','Cookie attribute metadata was observed without retaining cookie values.',refs);
      if(value.type==='redirect')signal(row,'OBSERVED_REDIRECT','A redirect relationship was recorded; destination authorization remains separate.',refs);
      if(value.type==='observed-route-pattern'&&typeof value.routePattern==='string'&&artifact.verification==='OBSERVED')signal(row,'EXPLICIT_ROUTE_PATTERN','Structured evidence explicitly records a route pattern.',refs);
    }
    for(const auth of [...asset.authenticatedSurfaces??[]].sort((a,b)=>a.scanRunId.localeCompare(b.scanRunId))){
      if(auth.legacy){plan.limitations.push('Historical Recon did not capture authentication contexts; missing context is unknown, not anonymous.');continue;}
      const safeContexts=new Map<string,ResearchContextRef>();let number=0;
      const eligibleContexts=auth.contexts.filter(context=>!['AUTH_CONTEXT_DUPLICATE_IDENTITY','AUTH_CONTEXT_LIMIT','AUTH_CONTEXT_SCOPE_BLOCKED','SKIPPED_SESSION_UNAVAILABLE','SKIPPED_SESSION_LOST','SESSION_UNAVAILABLE','SESSION_LOST','BLOCKED'].includes(context.state));
      for(const context of [...eligibleContexts].sort((a,b)=>a.mode===b.mode?a.contextKey.localeCompare(b.contextKey):a.mode==='ANONYMOUS'?-1:1)){
        if(!validId(context.contextKey))continue;
        safeContexts.set(context.contextKey,{contextKey:context.contextKey,label:context.mode==='ANONYMOUS'?'Anonymous':`Authenticated context ${++number}`,...(context.persona&&contextPersonas.has(context.persona)?{persona:context.persona}:{})});
      }
      const byCanonical=new Map<string,Surface>();
      for(const observation of [...auth.observations].sort((a,b)=>(a.id??'').localeCompare(b.id??''))){
        if(!validId(observation.id)||observation.responseClass==='UNAVAILABLE'||!observation.statusCode||observation.statusCode===429||observation.statusCode>=500)continue;
        if([404,410].includes(observation.statusCode)&&!auth.observations.some(other=>other.canonicalKey===observation.canonicalKey&&safeContexts.has(other.contextKey)&&other.responseClass==='CONTENT'&&Boolean(other.statusCode&&other.statusCode>=200&&other.statusCode<400)))continue;
        const context=safeContexts.get(observation.contextKey);if(!context)continue;
        const refs=['ReconSurfaceObservation:'+observation.id];
        // Distinct redacted private resources must not be merged just because
        // their public display URLs share [id]. The opaque canonical identity
        // is used internally only; no private URL or hash enters a plan item.
        const identity=observation.urlRedacted?`context:${observation.canonicalKey}`:undefined;
        const row=surface(observation.url,observation.method,refs,{identity,verified:observation.responseClass==='CONTENT',requestable:observation.urlRedacted!==true});if(!row)continue;
        refs.forEach(ref=>acceptedEvidence.add(ref));
        row.contexts.set(context.contextKey,context);byCanonical.set(observation.canonicalKey,row);
        if(observation.contextType==='AUTHENTICATED'&&observation.responseClass==='CONTENT')signal(row,'AUTHENTICATED_SURFACE','A verified authenticated context received content on this recorded surface.',refs);
        if(observation.contextType==='ANONYMOUS'&&observation.responseClass==='CONTENT')signal(row,'PUBLIC_SURFACE','An anonymous context received content on this recorded surface.',refs);
        if(observation.responseClass==='LOGIN_REDIRECT')signal(row,'AUTHENTICATION_SURFACE','The recorded response points to an authentication boundary.',refs);
        if(context.persona&&/^TENANT_[AB]$/.test(context.persona))signal(row,'DECLARED_TENANT_CONTEXT','An operator-declared tenant context contributed runtime evidence; ownership must still be established.',refs);
      }
      // Recompute from concrete observations. A precomputed visibility label
      // alone must never promote missing or expired identities into a signal.
      for(const visibility of deriveSurfaceVisibility(eligibleContexts,auth.observations.filter(observation=>safeContexts.has(observation.contextKey)))){
        if(!visibility.classifications.includes('CONTEXT_DIFFERENTIAL'))continue;
        const row=byCanonical.get(visibility.canonicalKey);if(!row)continue;
        const refs=unique(visibility.evidenceRefs.filter(validId).map(id=>'ReconSurfaceObservation:'+id).filter(ref=>row.refs.has(ref)));
        if(refs.length<2)continue;
        row.contextDifferential=true;signal(row,'CONTEXT_DIFFERENTIAL','Comparable recorded contexts received different content visibility. This is an investigation signal, not proof of broken authorization.',refs);
      }
      if(auth.truncated)plan.limitations.push('Authenticated Recon exports are bounded; missing context observations are not access denials.');
    }
    if(asset.graph){
      const nodes=new Map(asset.graph.nodes.map(node=>[node.id,node]));
      const graphSurface=(url:string,refs:string[])=>{
        const source=asset.artifacts.find(artifact=>artifact.value.url===url&&refs.includes('ReconArtifact:'+artifact.id));
        if(safeSurfaceUrl(url)!==url&&!source)return null;
        return surface(url,undefined,refs,{...(source?{identity:artifactSurfaceIdentity(source)}:{})});
      };
      for(const edge of [...asset.graph.edges].sort((a,b)=>a.id.localeCompare(b.id))){
        const refs=unique(edge.evidenceRefs.map(ref=>ref.startsWith('ReconArtifact:')||ref.startsWith('ReconSurfaceObservation:')?ref:'ReconArtifact:'+ref).filter(ref=>acceptedEvidence.has(ref)));
        if(!refs.length)continue;
        const from=nodes.get(edge.from),to=nodes.get(edge.to);
        if(edge.relation==='HAS_PARAMETER'&&from?.type==='ENDPOINT'&&to?.type==='PARAMETER'){
          const name=to.value.split('#').at(-1);
          if(!parameterName(name))continue;
          const row=graphSurface(from.value,refs);if(row){row.parameterNames.add(name);signal(row,'INPUT_PARAMETER','A proven asset-graph relationship records an input name for this endpoint.',refs);}
        }else if((edge.relation==='AUTHENTICATION_SURFACE'||edge.relation==='RESET_ROUTE')&&to?.type==='ENDPOINT'){
          const row=graphSurface(to.value,refs);if(row)signal(row,edge.relation==='RESET_ROUTE'?'ACCOUNT_LIFECYCLE_ROUTE':'AUTHENTICATION_SURFACE','A structured evidence relationship records this authentication or lifecycle surface.',refs);
        }else if(edge.relation==='CALLS'&&edge.verification==='OBSERVED'&&to?.type==='ENDPOINT'){
          const row=graphSurface(to.value,refs);if(row)signal(row,'OBSERVED_CALL_RELATION','A runtime-evidenced application call points to this endpoint; its contract and authorization still require review.',refs);
        }
      }
      if(asset.graph.truncated)plan.limitations.push('The asset graph is bounded; missing relationships are unknown.');
    }
    for(const technology of graphqlTechnologies){
      const matching=[...surfaces.values()].filter(row=>row.verified&&new URL(row.url).hostname===technology.hostname).sort((a,b)=>new URL(a.url).pathname.length-new URL(b.url).pathname.length||a.url.localeCompare(b.url));
      const explicitRoutes=matching.filter(row=>/\/(?:graphql|graphiql)(?:\/|$)/i.test(new URL(row.url).pathname));
      // Host-level fingerprints do not identify a route. Attach one advisory
      // objective to an existing representative page, without inventing /graphql.
      for(const row of explicitRoutes.length?explicitRoutes:matching.slice(0,1)){
        const refs=unique([...row.refs,technology.reference]);row.refs.add(technology.reference);
        signal(row,'GRAPHQL_TECH','A GraphQL technology fingerprint was recorded for this host. The endpoint and supported operations are not established by that fingerprint.',refs);
      }
    }
    const versionFamilies=new Map<string,{versions:Set<string>;rows:Surface[]}>(),versionFamilyOf=new Map<string,string>();
    for(const row of surfaces.values())if(row.verified&&row.requestable){
      const url=new URL(row.url),version=/\/(v\d+)(?=\/|$)/i.exec(url.pathname);if(!version)continue;
      const family=url.origin+url.pathname.slice(0,version.index)+'/<version>'+url.pathname.slice(version.index+version[0].length)+url.search;
      const existing=versionFamilies.get(family)??{versions:new Set<string>(),rows:[]};existing.versions.add(version[1].toLowerCase());existing.rows.push(row);versionFamilies.set(family,existing);versionFamilyOf.set(row.identity,family);
    }
    const candidates:ResearchPlanItem[]=[];
    for(const row of [...surfaces.values()].sort((a,b)=>a.identity.localeCompare(b.identity))){
      const path=new URL(row.url).pathname,refs=unique([...row.refs]);
      for(const name of new URL(row.url).searchParams.keys())if(parameterName(name))row.parameterNames.add(name);
      if(row.parameterNames.size)signal(row,'INPUT_PARAMETER','Named inputs were recorded without retaining parameter values.',refs);
      if([...row.parameterNames].some(name=>objectName.test(name))||row.pattern&&/\{(?:[^}]*_)?(?:id|uuid|[a-z]+Id)\}/i.test(row.pattern))signal(row,'OBJECT_IDENTIFIER','Structured evidence records an object identifier input or specification-declared identifier placeholder.',refs);
      if([...row.parameterNames].some(name=>tenantName.test(name)))signal(row,'TENANT_IDENTIFIER','A tenant-like identifier name was recorded; actual tenant ownership is not established.',refs);
      if([...row.parameterNames].some(name=>urlName.test(name)))signal(row,'URL_INPUT','A URL-like parameter name was observed; server-side fetching is not established.',refs);
      if([...row.parameterNames].some(name=>redirectName.test(name)))signal(row,'DESTINATION_INPUT','A destination-like parameter name was recorded; unsafe redirection is not established.',refs);
      const versionFamily=versionFamilyOf.get(row.identity),relatedVersions=versionFamily?versionFamilies.get(versionFamily):undefined;
      if(relatedVersions&&relatedVersions.versions.size>1)signal(row,'EXPLICIT_API_VERSION','Multiple observed versioned paths share the same explicit origin and route suffix; equivalent behavior or authorization is not assumed.',unique(relatedVersions.rows.flatMap(related=>[...related.refs])));
      if(/\/(?:graphql|graphiql)(?:\/|$)/i.test(path))signal(row,'GRAPHQL_ROUTE','Recon recorded a GraphQL-looking route; supported operations remain to be verified.',refs);
      if(/(?:^|\/)(?:uploads?|attachments?|imports?)(?:\/|$)/i.test(path))signal(row,'UPLOAD_ROUTE','An upload-related route name was recorded; upload behavior or unsafe handling is not established.',refs);
      if(/\/(?:checkout|cart|orders?|billing|payments?|subscriptions?|invoices?|redeem|coupons?)(?:\/|$)/i.test(path))signal(row,'BUSINESS_ROUTE','A business-workflow route name was recorded; its intended invariants require manual review.',refs);
      if(/\/(?:admin|administration|manage|management|console)(?:\/|$)/i.test(path))signal(row,'PRIVILEGED_ROUTE','An administrative-looking route was recorded; privilege level and accessibility are not inferred.',refs);
      if(/\/(?:register|signup|sign-up|reset(?:-password)?|forgot(?:-password)?|password-reset|recover|recovery|mfa|verify-email|change-email)(?:\/|$)/i.test(path))signal(row,'ACCOUNT_LIFECYCLE_ROUTE','An account-lifecycle route name was recorded; no lifecycle action was performed.',refs);
      const has=(...codes:string[])=>codes.some(code=>row.signals.has(code));
      const categorySignals:Record<ResearchCategory,string[]>={AUTHORIZATION:['OBJECT_IDENTIFIER','CONTEXT_DIFFERENTIAL'],AUTHENTICATION:['AUTHENTICATION_SURFACE'],SESSION_MANAGEMENT:['COOKIE_METADATA','AUTHENTICATED_SURFACE'],API:['API_SURFACE','API_SPECIFICATION','OBSERVED_CALL_RELATION'],API_VERSIONING:['EXPLICIT_API_VERSION'],GRAPHQL:['GRAPHQL_ROUTE','GRAPHQL_TECH'],FILE_UPLOAD:['UPLOAD_ROUTE'],SERVER_SIDE_REQUEST:['URL_INPUT'],REDIRECT_HANDLING:['OBSERVED_REDIRECT','DESTINATION_INPUT'],BUSINESS_LOGIC:['BUSINESS_ROUTE'],PRIVILEGED_FUNCTIONS:['PRIVILEGED_ROUTE'],ACCOUNT_LIFECYCLE:['ACCOUNT_LIFECYCLE_ROUTE'],TENANT_ISOLATION:['TENANT_IDENTIFIER','DECLARED_TENANT_CONTEXT'],INPUT_HANDLING:['INPUT_PARAMETER','FORM_METADATA']};
      for(const category of RESEARCH_CATEGORIES){
        if(!categorySignals[category].some(code=>row.signals.has(code)))continue;
        const surfaceRows=category==='API_VERSIONING'&&relatedVersions&&relatedVersions.versions.size>1?relatedVersions.rows:[row];
        const itemRefs=unique(surfaceRows.flatMap(surface=>[...surface.refs]));
        const definition=RESEARCH_CATEGORY_REGISTRY[category],stableKey=hash(`${RESEARCH_PLAN_VERSION}\0${input.programId}\0${boundary.id}\0${category}\0${category==='API_VERSIONING'?versionFamily:row.identity}`);
        if(exclusions.has(category)){plan.decisions.push({scopeAssetId:boundary.id,category,status:'NOT_APPLICABLE_BY_PROGRAM',reason:'Explicit program policy excludes this category. Recon signals do not override program rules.',evidenceRefs:itemRefs});continue;}
        const valueWeight=({CRITICAL:20,HIGH:15,MEDIUM:8,LOW:0} as Record<string,number>)[boundary.assetValue]??0;
        const differential=row.contextDifferential&&['AUTHORIZATION','TENANT_ISOLATION','PRIVILEGED_FUNCTIONS'].includes(category);
        const evidenceStrength=differential?'STRONG':row.verified||row.declared?'MODERATE':'LIMITED';
        const score=Math.min(100,definition.score+valueWeight+(differential?40:0)+(row.verified?12:0)+(row.declared?8:0)+(has('AUTHENTICATED_SURFACE')?6:0)+(row.parameterNames.size?6:0)+(priorityCategories.has(category)?10:0)+(surfaceRows.some(surface=>surface.signals.has('NEW_SURFACE'))?8:0));
        const priority:ResearchPriority=evidenceStrength==='LIMITED'?'LOW':score>=65?'HIGH':score>=35?'MEDIUM':'LOW';
        const relevant=new Set([...categorySignals[category],'NEW_SURFACE','AUTHENTICATED_SURFACE','PUBLIC_SURFACE',...(differential?['CONTEXT_DIFFERENTIAL']:[])]);
        const signalGroups=new Map<string,ResearchSignal>();
        for(const surface of surfaceRows)for(const item of surface.signals.values())if(relevant.has(item.code)){const old=signalGroups.get(item.code);signalGroups.set(item.code,{...item,evidenceRefs:unique([...(old?.evidenceRefs??[]),...item.evidenceRefs].filter(ref=>itemRefs.includes(ref)))});}
        const runtimeSignals=[...signalGroups.values()].sort((a,b)=>a.code.localeCompare(b.code));
        const surfaceRefs=surfaceRows.sort((a,b)=>a.url.localeCompare(b.url)).flatMap(surface=>{const methods=[...surface.methods].sort();return(methods.length?methods:[undefined]).map(method=>({url:surface.url,...(method?{method}:{}),...(surface.pattern?{pattern:surface.pattern}:{}),scopeAssetId:boundary.id,...(!surface.requestable||Boolean(method&&!['GET','HEAD'].includes(method))?{requestable:false as const}:{})}));});
        const contextRefs=[...new Map(surfaceRows.flatMap(surface=>[...surface.contexts.values()].map(context=>[context.contextKey,context] as const))).values()].sort((a,b)=>a.contextKey.localeCompare(b.contextKey));
        candidates.push({stableKey,category,priority,title:definition.title,objective:definition.objective,rationale:`${runtimeSignals.map(item=>item.description).join(' ')} ${row.verified?'At least one content response was observed.':row.declared?'A specification declaration is evidence of a contract, not a verified live endpoint.':'Live availability was not verified; confirm the recorded surface before active investigation.'} Asset value affects order only, never authorization.`,methodology:[...(!row.verified?['Verify the recorded surface and its current authorization before any active research.']:[]),...definition.checks],surfaceRefs,evidenceRefs:itemRefs,contextRefs,runtimeSignals,sourceSignals:[],sourceEvidenceRefs:[],score,evidenceStrength,status:'READY'});
      }
    }
    const ordered=[...new Map(candidates.map(item=>[item.stableKey,item])).values()].sort(compareItems);
    plan.items.push(...ordered.slice(0,20));
    if(ordered.length>20){plan.decisions.push({scopeAssetId:boundary.id,status:'ITEM_LIMIT',reason:'The per-asset limit retains the 20 highest-ranked objectives; remaining evidence stays in Recon.',evidenceRefs:[]});plan.limitations.push(`Scope Asset ${boundary.id}: 20 prioritized items retained from ${ordered.length} grounded objectives.`);}
    if(staticCount)plan.decisions.push({scopeAssetId:boundary.id,status:'STATIC_ASSET_OMITTED',reason:'Static resources are evidence inventory, not standalone research objectives.',evidenceRefs:[]});
    if(outsideCount)plan.decisions.push({scopeAssetId:boundary.id,status:'OUT_OF_SCOPE',reason:'Evidence outside the current explicit authorization boundary was excluded from actionable objectives.',evidenceRefs:[]});
    if(invalidCount)plan.decisions.push({scopeAssetId:boundary.id,status:'INVALID_EVIDENCE',reason:'Malformed or unreferenced records were ignored; no facts were invented.',evidenceRefs:[]});
    if(!ordered.length&&!exclusions.size)plan.decisions.push({scopeAssetId:boundary.id,status:'NO_RUNTIME_SIGNAL',reason:'No supported structured runtime signal produced an objective. This does not prove the absence of vulnerabilities.',evidenceRefs:[]});
  }
  plan.items.sort(compareItems);plan.decisions.sort((a,b)=>a.scopeAssetId.localeCompare(b.scopeAssetId)||(a.category??'').localeCompare(b.category??'')||a.status.localeCompare(b.status)||JSON.stringify(a.evidenceRefs).localeCompare(JSON.stringify(b.evidenceRefs)));
  plan.limitations=unique(plan.limitations);plan.notes=unique(plan.notes);
  return plan;
}
function compareItems(a:ResearchPlanItem,b:ResearchPlanItem){return b.score-a.score||RESEARCH_CATEGORIES.indexOf(a.category)-RESEARCH_CATEGORIES.indexOf(b.category)||a.stableKey.localeCompare(b.stableKey);}
const markdown=(value:string)=>text(value,3000).replace(/([\\`*_{}\[\]<>|#])/g,'\\$1');
export function renderResearchPlanMarkdown(plan:ResearchPlan){
  const lines=['# Research Plan','',`Format: ${plan.version}`,'',...plan.notes.map(note=>markdown(note)),'','These are manual research objectives, not findings. No network action is authorized by this document.',''];
  for(const item of plan.items){lines.push(`## ${markdown(item.title)} — ${item.priority}`,'',`Stable key: ${item.stableKey}`,`Category: ${item.category}`,`Evidence strength: ${item.evidenceStrength}`,'',markdown(item.objective),'',markdown(item.rationale),'','### Recorded surface','',...item.surfaceRefs.map(surface=>`- ${markdown(surface.method??'Unknown method')} ${markdown(surface.url)}${surface.requestable===false?' — sanitized or non-requestable evidence reference':''}`),'','### Contexts','',...(item.contextRefs.length?item.contextRefs.map(context=>`- ${markdown(context.label)}${context.persona?` — operator-declared ${markdown(context.persona)}`:''}`):['Authentication context was not captured for these facts; it is unknown.']),'','### Methodology','',...item.methodology.map((step,index)=>`${index+1}. ${markdown(step)}`),'','### Evidence','',...item.evidenceRefs.map(ref=>`- ${markdown(ref)}`),'');}
  if(plan.decisions.length)lines.push('## Planning decisions','',...plan.decisions.map(decision=>`- ${decision.category??decision.scopeAssetId}: ${decision.status} — ${markdown(decision.reason)}`),'');
  lines.push('## Limitations','',...plan.limitations.map(note=>`- ${markdown(note)}`),'','Source content available: false. Source analysis performed: false.','');
  return lines.join('\n');
}
