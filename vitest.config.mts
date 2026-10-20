import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

// Node environment: these suites exercise server-side logic (crypto, gate
// policy, scanner decision paths, API route handlers) — no DOM required. The
// `@` alias mirrors tsconfig.json paths so `@/lib/...` imports resolve the same
// way in tests as in the app.
//
// This file is .mts (ESM) so Vite loads it natively without the CommonJS-interop
// warning; `import.meta.dirname` replaces the CJS `__dirname` (Node >= 20.11).
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src"),
    },
  },
});
