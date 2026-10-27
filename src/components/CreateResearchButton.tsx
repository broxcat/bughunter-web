"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
export default function CreateResearchButton({ targetId, disabled = false }: { targetId: string; disabled?: boolean }) {
  const router = useRouter(), pending = useRef(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function create() {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError("");
    try {
      const r = await fetch("/api/research-sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ targetId }) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Unable to create workspace");
      router.push(`/research/${data.id}`); router.refresh();
    } catch (e) { setError((e as Error).message); }
    finally { pending.current = false; setBusy(false); }
  }
  return <div><Button disabled={disabled || !targetId || busy} onClick={create}>{busy ? "Creating…" : "Create Research Workspace"}</Button>{error && <p role="alert" className="text-danger">{error}</p>}</div>;
}
