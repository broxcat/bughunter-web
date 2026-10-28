import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfigFromFile } from "@prisma/config";

// Exercise the real Prisma/c12 loader and the merger resolved by @prisma/config.
// These contracts must hold when overriding its pinned deepmerge-ts dependency.
const require = createRequire(import.meta.url);
const configRequire = createRequire(require.resolve("@prisma/config"));
let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "bughunter-prisma-config-"));
  await writeFile(join(root, "package.json"), "{}");
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe("Prisma config dependency compatibility", () => {
  it("keeps schema-based defaults when no config file exists (the application setup)", async () => {
    const result = await loadConfigFromFile({ configRoot: root });
    expect(result.error).toBeUndefined();
    expect(result.resolvedPath).toBeNull();
    expect(result.config).toMatchObject({ loadedFromFile: null });
    expect(result.config?.schema).toBeUndefined();
    expect(result.diagnostics).toEqual([]);
  });

  it.each(["cjs", "mjs", "ts"])("loads %s config, nested datasource and migration paths", async extension => {
    const filename = join(root, `prisma.config.${extension}`);
    const config = {
      schema: "prisma/schema.prisma",
      engine: "classic",
      datasource: { url: "postgresql://fixture:fixture@127.0.0.1:1/unused", directUrl: "postgresql://fixture:fixture@127.0.0.1:2/unused" },
      migrations: { path: "prisma/migrations", seed: "node fixture-seed.mjs" },
      experimental: { externalTables: true },
      tables: { external: ["audit_log", "external_record"] },
    };
    const source = extension === "cjs" ? `module.exports = ${JSON.stringify(config)};`
      : extension === "mjs" ? `export default ${JSON.stringify(config)};`
      : `import { defineConfig } from ${JSON.stringify(require.resolve("prisma/config"))};\nexport default defineConfig(${JSON.stringify(config)});`;
    await writeFile(filename, source);
    const result = await loadConfigFromFile({ configRoot: root, configFile: filename });
    expect(result.error).toBeUndefined();
    expect(result.resolvedPath).toBe(filename);
    expect(result.config).toMatchObject({
      ...config,
      loadedFromFile: filename,
      schema: join(root, config.schema),
      migrations: { ...config.migrations, path: join(root, config.migrations.path) },
    });
  });

  it("preserves errors for an explicitly missing or invalid configuration", async () => {
    const filename = join(root, "prisma.config.cjs");
    const missing = await loadConfigFromFile({ configRoot: root, configFile: filename });
    expect(missing.error?._tag).toBe("ConfigFileNotFound");
    await writeFile(filename, "module.exports = { schema: 42 };");
    const invalid = await loadConfigFromFile({ configRoot: root, configFile: filename });
    expect(invalid.error?._tag).toBe("ConfigFileSyntaxError");
    expect(invalid.config).toBeUndefined();
  });

  it("does not implicitly load a config directory's .env file", async () => {
    const filename = join(root, "prisma.config.cjs");
    const name = `BUGHUNTER_CONFIG_FIXTURE_${process.pid}`;
    await writeFile(join(root, ".env"), `${name}=unexpected.prisma\n`);
    await writeFile(filename, `module.exports = { schema: process.env[${JSON.stringify(name)}] ?? 'fallback.prisma' };`);
    const result = await loadConfigFromFile({ configRoot: root, configFile: filename });
    expect(result.error).toBeUndefined();
    expect(result.config?.schema).toBe(join(root, "fallback.prisma"));
    expect(process.env[name]).toBeUndefined();
  });

  it("retains the used merger's precedence, arrays, undefined and callback identity without mutating inputs", () => {
    const { deepmerge } = configRequire("deepmerge-ts") as typeof import("deepmerge-ts");
    const adapter = () => Promise.resolve("fixture adapter");
    const base = { datasource: { url: "base", directUrl: "direct" }, tables: { external: ["one"] }, studio: { adapter } };
    const extra = { datasource: { url: "override", directUrl: undefined }, tables: { external: ["two"] } };
    const merged = deepmerge(base, extra);
    expect(merged).toEqual({ datasource: { url: "override", directUrl: "direct" }, tables: { external: ["one", "two"] }, studio: { adapter } });
    expect(merged.studio.adapter).toBe(adapter);
    expect(base.datasource.url).toBe("base");
    expect(base.tables.external).toEqual(["one"]);
    expect(extra.tables.external).toEqual(["two"]);
  });
});
