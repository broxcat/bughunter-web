import { auth } from '@/lib/auth';
import { buildReconReportModel } from '@/lib/reconReportModel';
import { routeId } from '@/lib/routeParams';
import { loadReconReportFacts } from '@/server/recon/reportFacts';
import { renderReconReportPdf } from '@/server/recon/reportPdf';
import { admitPdfExport } from '@/server/recon/pdfExportGate';
import { ResearchError } from '@/server/research/workspace';
type Params={params:Promise<{id:string}>};
export const dynamic='force-dynamic';
export async function GET(_req:Request,{params}:Params){
  const userId=(await auth())?.user?.id;if(!userId)return Response.json({error:'Unauthorized'},{status:401});
  const id=routeId((await params).id);if(!id)return Response.json({error:'Not found'},{status:404});
  try{
    // Ownership and data checks run before any Chromium capacity is taken.
    const facts=await loadReconReportFacts(userId,id),model=buildReconReportModel(facts);
    const admission=await admitPdfExport(userId);
    if(!admission.admitted)return Response.json({error:admission.reason==='BUSY'?'Another PDF export is being generated. Retry shortly.':'PDF export limit reached. Retry later.'},{status:429,headers:{'Retry-After':String(admission.retryAfterSec),'Cache-Control':'private, no-store'}});
    let pdf:Buffer;try{pdf=await renderReconReportPdf(model);}finally{admission.release();}
    const slug=facts.program.companyName.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,40)||'target';const date=(facts.run.startedAt??facts.run.createdAt).slice(0,10);
    return new Response(new Uint8Array(pdf),{headers:{'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="rapport-recon-${slug}-${date}-${id.slice(0,8)}.pdf"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
  }catch(error){if(error instanceof ResearchError)return Response.json({error:error.message},{status:error.status});return Response.json({error:'PDF report unavailable'},{status:503});}
}
