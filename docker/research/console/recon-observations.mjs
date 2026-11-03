import { createHash } from 'node:crypto';
import { verifyReconCollection } from '../../../src/lib/research/reconCollection.ts';
import { assetAllowsHost } from '../../../src/lib/scopeAssets.ts';
import { isExcluded } from '../../../src/lib/bountyProgram.ts';
import { historyArguments,sanitizeHistoryItem,parseHistory } from '../validator/burp-http.mjs';
import { withBurp } from '../validator/burp-upstream.mjs';
/** Direct passive MCP collection: no tmux, no provider, no replay/active tools. */
export async function collectReconObservations(token,key,upstream=withBurp){
  const c=verifyReconCollection(token,key),observations=[];
  try{
    let version='unknown';
    for(const d of c.destinations){if(!assetAllowsHost(c.asset,d.hostname)||isExcluded(d.hostname,c.exclusions))continue;
      const policy={targetHost:d.hostname,scheme:d.scheme,port:d.port,requiredUserAgent:'',assetScope:c.asset};
      await upstream(async client=>{version=client.getServerVersion?.()?.version??'unknown';const result=await client.callTool({name:'get_proxy_http_history_regex',arguments:historyArguments(policy,10,0)},undefined,{timeout:4000});
        parseHistory(result,policy); // Reuse the existing error/denied/size boundary.
        let bytes=0;
        for(const block of result.content??[]){if(block.type!=='text'||typeof block.text!=='string')continue;bytes+=block.text.length;if(bytes>262144)throw new Error('History limit');
          for(const part of block.text.trim().split(/\r?\n\s*\r?\n/).slice(0,10))try{const raw=JSON.parse(part),item=sanitizeHistoryItem(raw,policy);if(!item)continue;
            const fingerprint=value=>createHash('sha256').update(String(value)).digest('hex');
            const observedAt=typeof raw.timestamp==='string'&&Number.isFinite(Date.parse(raw.timestamp))&&Date.parse(raw.timestamp)<=Date.now()+300000?new Date(raw.timestamp).toISOString():undefined;
            observations.push({url:item.url,method:item.method,statusCode:item.status,contentType:item.contentType,type:'burp-history',requestRef:'BurpRequest:'+fingerprint(raw.request),responseRef:'BurpResponse:'+fingerprint(raw.response),...(observedAt?{originalObservedAt:observedAt}:{}),collectedAt:new Date().toISOString(),timestampMeaning:observedAt?'UPSTREAM_TIMESTAMP':'COLLECTION_TIME_ONLY',authenticatedMaterialPresent:item.authenticatedMaterialPresent,setsCookie:item.setsCookie,mcpVersion:String(version).slice(0,80)});
          }catch{/* Malformed/truncated history never authorizes requests. */}
        }
      },5000);
    }
    return{status:'AVAILABLE',observations,version:String(version).slice(0,80)};
  }catch{return{status:'UNAVAILABLE',observations};}
}
