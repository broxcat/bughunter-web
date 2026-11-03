import type { ReconFailureReason } from '@/lib/reconCapabilities';
/** Shared feedback policy. No absence/blocked response becomes a negative finding. */
export class ReconProtection {
  private samples: boolean[]=[]; private failures=0; private requests=0; private next=0;
  blocked=false; reason=''; reasonCode:ReconFailureReason='NETWORK_UNREACHABLE'; slowdown=1;
  constructor(public readonly rps:number,public readonly maxRequests:number) {}
  observe(status?:number,error?:string) {
    if(status===429)this.reasonCode='RATE_LIMITED';else if(status===403)this.reasonCode='WAF_BLOCKED';else if(status&&status>=500)this.reasonCode='TEMPORARY_UPSTREAM';else if(error)this.reasonCode=/timeout|timed.out/i.test(error)?'TIMEOUT':'NETWORK_UNREACHABLE';
    const bad=Boolean(error)||status===429||status===403||(status!==undefined&&status>=500);
    this.samples.push(bad); if(this.samples.length>10)this.samples.shift();
    this.failures=bad?this.failures+1:0;
    if(bad)this.slowdown=Math.min(8,this.slowdown*2);
    if(status===429||this.failures>=3||(this.samples.length>=5&&this.samples.filter(Boolean).length/this.samples.length>=0.6)) {this.blocked=true;this.reason=status===429?'Rate limiting (HTTP 429)':error?'Repeated transport failures / timeouts':'Repeated blocking or server errors';}
  }
  async beforeRequest(signal:AbortSignal) {
    if(this.blocked)throw new Error('BLOCKED: '+this.reason);
    if(++this.requests>this.maxRequests){this.blocked=true;this.reason='Request budget exhausted';this.reasonCode='RESOURCE_LIMIT';throw new Error('PARTIAL: '+this.reason);}
    const delay=Math.max(0,this.next-Date.now());this.next=Math.max(Date.now(),this.next)+1000*this.slowdown/this.rps;
    if(delay)await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},delay);const abort=()=>{clearTimeout(timer);reject(signal.reason);};signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();});
    signal.throwIfAborted();
    if(this.blocked)throw new Error('BLOCKED: '+this.reason);
  }
}
