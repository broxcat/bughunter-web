import type { ScanContext } from "./context";
import { runFamilyTechniques } from "@/server/hunt/runtime";

/** Catalogue-only dispatcher: no legacy payloads or arbitrary scanner choice. */
export async function runBusinessLogicTamper(ctx: ScanContext): Promise<void> {
  await runFamilyTechniques(ctx, "business-logic-tamper");
}
