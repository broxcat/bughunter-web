import {auth} from '@/lib/auth';
import {prisma} from '@/lib/prisma';
import {notFound} from 'next/navigation';
import ReportEditor from '@/components/ReportEditor';
export default async function ReportPage({params}:{params:Promise<{id:string}>}){const {id}=await params,userId=(await auth())?.user?.id;if(!userId)return null;const program=await prisma.bountyProgram.findFirst({where:{id,ownerId:userId},select:{id:true}});if(!program&&!await prisma.target.findFirst({where:{id,userId},select:{id:true}}))notFound();return <ReportEditor id={id} programMode={Boolean(program)}/>;}
