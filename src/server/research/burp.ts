import { burpDiagnosticSchema } from "@/lib/research/burp";
import { HypothesisWorkspace } from "./hypothesisFiles";
import { researchRoot } from "./sessions";

/** This is an untrusted last-runner diagnostic, not live remote attestation.
 * No network, subprocess, raw evidence or endpoint secrets reach the web. */
export async function readBurpDiagnostic(workspaceId: string) {
  let workspace: HypothesisWorkspace | undefined;
  try {
    workspace = await HypothesisWorkspace.open(researchRoot(), workspaceId);
    const raw = await workspace.readBurpDiagnostic();
    const diagnostic = burpDiagnosticSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)));
    if (diagnostic.workspaceId !== workspaceId) return null;
    const age = Date.now() - Date.parse(diagnostic.checkedAt);
    if (age < -10000 || age > 5 * 60 * 1000) return null;
    return diagnostic;
  } catch { return null; }
  finally { await workspace?.close(); }
}
