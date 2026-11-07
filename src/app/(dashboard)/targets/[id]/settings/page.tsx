import TargetSettings from '@/components/TargetSettings';
export default async function Settings({params}:{params:Promise<{id:string}>}){const{id}=await params;return <TargetSettings key={id} id={id}/>;}
