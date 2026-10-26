import type { HuntFamilySelection as Selection } from "@/lib/hunt/policy";
export default function HuntFamilySelection({ families }: { families: Selection[] }) {
  return <div className="space-y-3" aria-label="Hunt vulnerability selection">
    <h2 className="font-semibold">Selected vulnerability families</h2>
    <ul className="grid gap-1 sm:grid-cols-2">{families.filter(f => f.selected).map(f => <li key={f.family}>✓ {f.displayName}</li>)}</ul>
    {!families.some(f => f.selected) && <p>No supported family selected.</p>}
    <details><summary>Not selected</summary><ul>{families.filter(f => !f.selected).map(f => <li key={f.family}>— {f.displayName}{f.reason === "UNSUPPORTED" ? " (unsupported)" : ""}</li>)}</ul></details>
    <details><summary>Advanced — selection reasons</summary><ul className="text-sm">{families.map(f => <li key={f.family}>{f.displayName}: {f.reason}</li>)}</ul></details>
  </div>;
}
