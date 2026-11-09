'use client';
import {useState,useTransition} from 'react';
import {useRouter} from 'next/navigation';
import {Button} from './ui/Button';
export default function TargetReconActions({programId,running,disabled}:{programId:string;running:boolean;disabled?:boolean}){
 const router=useRouter(),[busy,setBusy]=useState(false),[error,setError]=useState(''),[pending,startTransition]=useTransition();
 async function act(){setBusy(true);setError('');try{const r=await fetch(`/api/programs/${programId}/recon`,{method:running?'DELETE':'POST'});if(!r.ok)throw new Error((await r.json()).error??'Recon unavailable');startTransition(()=>router.refresh());}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <div><Button disabled={busy||pending||disabled} variant={running?'secondary':'primary'} onClick={()=>void act()}>{busy||pending?'Saving…':running?'Cancel recon':'Start recon'}</Button>{error&&<p role="alert" className="mt-2 text-sm">{error}</p>}</div>;
}
