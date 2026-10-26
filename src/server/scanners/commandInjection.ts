import type { ScanContext } from "./context";
import { runFamilyTechniques } from "@/server/hunt/runtime";

/** Catalogue-only dispatcher: no legacy payloads or arbitrary scanner choice. */
export async function runCommandInjection(ctx: ScanContext): Promise<void> {
  await runFamilyTechniques(ctx, "command-injection");
}
