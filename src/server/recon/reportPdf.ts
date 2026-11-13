import { chromium } from 'playwright-chromium';
import type { ReconReportModel } from '@/lib/reconReportModel';
import { renderReconReportHtml } from '@/lib/reconReportHtml';

export const MAX_REPORT_PDF_BYTES=25*1024*1024;
export async function renderReconReportPdf(model:ReconReportModel){
 const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
 try{const context=await browser.newContext({javaScriptEnabled:false});const page=await context.newPage();
  await page.route('**/*',route=>route.abort('blockedbyclient'));
  await page.setContent(renderReconReportHtml(model),{waitUntil:'domcontentloaded',timeout:15_000});
  const pdf=await page.pdf({format:'A4',printBackground:true,preferCSSPageSize:true,margin:{top:'18mm',right:'14mm',bottom:'18mm',left:'14mm'},displayHeaderFooter:true,headerTemplate:'<div style="font-size:8px;color:#000;width:100%;padding:0 14mm">Rapport de reconnaissance</div>',footerTemplate:'<div style="font-size:8px;color:#000;width:100%;padding:0 14mm;text-align:right">Page <span class="pageNumber"></span> / <span class="totalPages"></span></div>'});
  if(pdf.byteLength>MAX_REPORT_PDF_BYTES)throw new Error('PDF export exceeds the 25 MB limit');return pdf;
 }finally{await browser.close();}
}
