import type { ReconReportModel } from '@/lib/reconReportModel';
import { renderReconReportHtml } from '@/lib/reconReportHtml';
import { launchIsolatedBrowser } from '@/server/isolatedBrowser';

export const MAX_REPORT_PDF_BYTES=25*1024*1024;
export const PDF_RENDER_DEADLINE_MS=30_000;
export async function renderReconReportPdf(model:ReconReportModel){
 const browser=await launchIsolatedBrowser({},'pdf');
 // M4: a hard deadline closes Chromium even if layout or printing stalls.
 let deadline:ReturnType<typeof setTimeout>|undefined;
 const timedOut=new Promise<never>((_,reject)=>{deadline=setTimeout(()=>reject(new Error('PDF render deadline exceeded')),PDF_RENDER_DEADLINE_MS);});
 try{return await Promise.race([timedOut,(async()=>{const context=await browser.newContext({javaScriptEnabled:false});const page=await context.newPage();
  await page.route('**/*',route=>route.abort('blockedbyclient'));
  await page.setContent(renderReconReportHtml(model),{waitUntil:'domcontentloaded',timeout:15_000});
  const pdf=await page.pdf({format:'A4',printBackground:true,preferCSSPageSize:true,margin:{top:'18mm',right:'14mm',bottom:'18mm',left:'14mm'},displayHeaderFooter:true,headerTemplate:'<div style="font-size:8px;color:#000;width:100%;padding:0 14mm">Rapport de reconnaissance</div>',footerTemplate:'<div style="font-size:8px;color:#000;width:100%;padding:0 14mm;text-align:right">Page <span class="pageNumber"></span> / <span class="totalPages"></span></div>'});
  if(pdf.byteLength>MAX_REPORT_PDF_BYTES)throw new Error('PDF export exceeds the 25 MB limit');return pdf;
 })()]);
 }finally{clearTimeout(deadline);await browser.close();}
}
