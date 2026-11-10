import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notFound, redirect } from "next/navigation";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const userId = (await auth())?.user?.id;
  if (!userId) return null;
  const { id } = await params;
  const session = await prisma.researchSession.findFirst({
    where: { userId, OR: [{ id }, { targetId: id }] },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (session) redirect("/research/history/" + session.id);
  const target = await prisma.target.findFirst({
    where: { id, userId },
    select: { programId: true },
  });
  if (target?.programId) redirect("/research?program=" + target.programId);
  notFound();
}
