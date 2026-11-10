"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
export default function DiscoveredHosts({
  runId,
  hosts,
}: {
  runId: string;
  hosts: { host: string; responsive: boolean; source: string; state: string }[];
}) {
  const [selected, setSelected] = useState<string[]>([]),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const router = useRouter();
  async function add() {
    setBusy(true);
    try {
      const r = await fetch(`/api/recon/runs/${runId}/scope`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hosts: selected }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      setSelected([]);
      setMessage("Selected hosts added to scope.");
      router.refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Scope update failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-3">
      <h2>Discovered hosts</h2>
      <p className="text-sm text-muted">
        Discovery does not grant authorization. Select hosts explicitly to add
        them to scope.
      </p>
      <ul>
        {hosts.map((h) => (
          <li key={h.host} className="flex gap-3 py-1">
            {h.state === "candidate" && (
              <input
                aria-label={"Select " + h.host}
                type="checkbox"
                checked={selected.includes(h.host)}
                onChange={(e) =>
                  setSelected(
                    e.target.checked
                      ? [...selected, h.host]
                      : selected.filter((v) => v !== h.host),
                  )
                }
              />
            )}
            <span>
              {h.host} ·{" "}
              {h.responsive
                ? "HTTP/HTTPS responsive"
                : "No web response recorded"}{" "}
              ·{" "}
              {h.state === "authorized"
                ? "In scope"
                : h.state === "excluded"
                  ? "Out of scope — change Target settings first"
                  : h.source}
            </span>
          </li>
        ))}
      </ul>
      <button
        className="ui-btn"
        disabled={busy || !selected.length}
        onClick={() => void add()}
      >
        Add selected to scope
      </button>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
