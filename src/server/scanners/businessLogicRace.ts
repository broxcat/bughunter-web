import type { ScanContext } from "./context";
import { runFamilyTechniques } from "@/server/hunt/runtime";

/** Catalogue-only dispatcher: no legacy payloads or arbitrary scanner choice. */
export async function runBusinessLogicRace(ctx: ScanContext): Promise<void> {
  await runFamilyTechniques(ctx, "business-logic-race");
}
