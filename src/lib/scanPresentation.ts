import type { BadgeTone } from "@/components/ui/Badge";

export function scanPresentation(status: string, outcome?: string | null, dispatch?: string | null, executionState?: string | null, cancelRequested = false): { label: string; tone: BadgeTone } {
  if (["QUEUED", "RUNNING"].includes(status) && cancelRequested) return { label: "Annulation demandée", tone: "medium" };
  if (executionState === "INTERRUPTED") return { label: "Exécution interrompue", tone: "killed" };
  if (status === "QUEUED" && dispatch === "PENDING") return { label: "En attente de publication", tone: "medium" };
  if (status === "QUEUED" && dispatch === "PUBLISHED") return { label: "En file d’attente", tone: "neutral" };
  if (status === "QUEUED") return { label: "En attente", tone: "neutral" };
  if (status === "RUNNING") return { label: "En cours", tone: "info" };
  if (outcome === "UNSUPPORTED") return { label: "Non pris en charge", tone: "medium" };
  if (status === "FAILED" || outcome === "FAILED") return { label: "Échec", tone: "killed" };
  if (status === "COMPLETED") {
    if (outcome === "SUCCESS") return { label: "Terminé", tone: "passed" };
    if (outcome === "PARTIAL") return { label: "Terminé partiellement", tone: "medium" };
    return { label: "Terminé · résultat historique inconnu", tone: "neutral" };
  }
  if (status === "CANCELLED") return { label: "Annulé", tone: "neutral" };
  return { label: status === "CONNECTING" ? "Connexion…" : "Déconnecté", tone: "neutral" };
}
