import HuntRunProgress from "@/components/HuntRunProgress";
export default async function HuntRunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <HuntRunProgress key={id} id={id} />;
}
