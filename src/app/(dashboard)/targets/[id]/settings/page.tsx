import TargetSettings from '@/components/TargetSettings';
export default async function Settings({params}:{params:Promise<{id:string}>}){return <TargetSettings id={(await params).id}/>;}
