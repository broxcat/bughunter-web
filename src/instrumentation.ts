import { assertRequiredEnv } from "@/lib/env";

// Next.js boot hook: runs once when the server process starts. We validate
// required secrets here so a missing/malformed key fails loudly at startup with
// a clear message, instead of surfacing as a cryptic error on the first request
// that happens to need encryption or session verification.
export async function register() {
  // Only assert server-side. instrumentation can also load in the edge runtime;
  // the secrets below are only ever used from the Node.js runtime.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    assertRequiredEnv();
  }
}
