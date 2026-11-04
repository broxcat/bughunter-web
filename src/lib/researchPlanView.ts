/** Public advisory DTO. Never include authentication proof or remote bodies. */
export type ResearchPlanView = {
  id:string;targetId:string;programId:string;scopeAssetId:string|null;scanRunId:string;
  sourceFingerprint:string;methodologyVersion:string;assessmentMode:'BLACK_BOX'|'WHITE_BOX'|null;
  status:'CURRENT'|'SUPERSEDED'|'STALE';createdAt:string;supersededAt:string|null;
  limitations:string[];notes:string[];authorizedSourceCount:number;sourceAnalysisPerformed:false;
  items:Array<{
    id:string;stableKey:string;category:string;priority:'HIGH'|'MEDIUM'|'LOW';title:string;
    objective:string;rationale:string;methodology:string;
    surfaceRefs:Array<{url:string;method?:string;pattern?:string;scopeAssetId?:string;requestable?:false}>;
    evidenceRefs:string[];contextRefs:Array<{contextKey:string;label:string;persona?:string|null}>;
    runtimeSignals:unknown[];sourceSignals:unknown[];sourceEvidenceRefs:string[];
    status:'READY'|'NOT_APPLICABLE_BY_PROGRAM';score:number;evidenceStrength:number;isNew:boolean;
    hypotheses:Array<{id:string;externalId:string;title:string;status:string}>;
    findings:Array<{id:string;title:string;reviewStatus:string}>;
  }>;
};
export type ResearchPlanPanelState={
  plan:ResearchPlanView|null;history:Array<{id:string;createdAt:string;status:string;scanRunId:string}>;
  sessionPlanId:string|null;newPlanAvailable:boolean;reconCurrent:boolean;configurationChanged:boolean;
};
