import { redirect } from 'next/navigation';
export default async function Page({searchParams}:{searchParams:Promise<{target?:string}>}){const {target}=await searchParams;redirect(target?'/targets/'+encodeURIComponent(target)+'/settings':'/targets');}
