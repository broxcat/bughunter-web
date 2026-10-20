import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

// Node environment: these suites exercise server-side logic (crypto, gate
// policy, scanner decision paths, API route handlers) — no DOM required. The
// `@` alias mirrors tsconfig.json paths so `@/lib/...` imports resolve the same
// way in tests as in the app.
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
});
