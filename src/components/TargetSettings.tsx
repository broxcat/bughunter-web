'use client';
import Link from 'next/link';
import { useEffect,useState } from 'react';
import { useRouter } from 'next/navigation';
import ProgramForm,{type ProgramData} from './ProgramForm';
import DeleteResourceButton from './DeleteResourceButton';
export default function TargetSettings({id}:{id:string}){const router=useRouter(),[program,setProgram]=useState<ProgramData|null>(null),[error,setError]=useState('');useEffect(()=>{fetch('/api/programs/'+id,{cache:'no-store'}).then(async r=>{if(!r.ok)throw new Error('Target not found');setProgram(await r.json());}).catch(e=>setError(e.message));},[id]);const current=program?.id===id?program:null;return <div className="space-y-5"><Link className="text-brand" href={'/targets/'+id}>← Target</Link><h1 className="text-2xl font-semibold">Target settings</h1>{error&&<p role="alert">{error}</p>}{!current&&!error&&<p role="status">Loading target settings…</p>}{current&&<><ProgramForm initial={current} onSaved={()=>router.push('/targets/'+id+'?saved=1')}/><details className="ui-disclosure"><summary>Delete target</summary><div className="mt-4"><DeleteResourceButton kind="Target" name={current.companyName} url={'/api/programs/'+id} redirectTo="/targets?deleted=1"/></div></details></>}</div>;}
