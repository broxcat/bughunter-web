import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  program: {
    id: "program",
    ownerId: "owner",
    outOfScope: ["blocked.example.test"],
    scopeRules: [],
    scopeAssets: [],
    executionPolicies: [],
  },
  assets: [] as { normalizedValue: string; format: string; active: boolean }[],
  create: vi.fn(),
  auth: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ auth: m.auth }));
vi.mock("@/lib/prisma", () => {
  const db = {
    targetReconRun: {
      findFirst: vi.fn(async () => ({ programId: "program" })),
      findFirstOrThrow: vi.fn(async () => ({ programId: "program" })),
    },
    bountyProgram: {
      update: vi.fn(), findUniqueOrThrow: vi.fn(async () => m.program) },
    programExecutionPolicy: { findFirst: vi.fn(async () => null) },
    scopeAsset: { findMany: vi.fn(async () => m.assets), upsert: m.create },
    $queryRaw: vi.fn(async () => [{ id: "program" }]),
  };
  return {
    prisma: {
      ...db,
      $transaction: async (fn: (tx: unknown) => unknown) => fn(db),
    },
  };
});
vi.mock("@/server/recon/reportFacts", () => ({
  loadReconReportFacts: vi.fn(async () => ({})),
}));
vi.mock("@/lib/reconReportModel", () => ({
  buildReconReportModel: () => ({
    dns: [
      { host: "new.example.test", source: "DNS" },
      { host: "blocked.example.test", source: "DNS" },
    ],
    web: { responsiveHosts: ["new.example.test"] },
  }),
}));
import {
  discoveredScopeCandidates,
  addDiscoveredScope,
} from "@/server/recon/discoveredScope";
import { POST } from "@/app/api/recon/runs/[id]/scope/route";

describe("manual discovered-host authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.assets = [];
    m.auth.mockResolvedValue({ user: { id: "owner" } });
  });
  it("opening Recon never creates authorization", async () => {
    expect(await discoveredScopeCandidates("owner", "run")).toContainEqual({
      host: "new.example.test",
      source: "DNS",
      responsive: true,
      state: "candidate",
    });
    expect(m.create).not.toHaveBeenCalled();
  });
  it("requires explicit selection, then creates only the selected ScopeAsset", async () => {
    const request = (hosts: string[]) =>
      new Request("http://localhost/api/recon/runs/run/scope", {
        method: "POST",
        body: JSON.stringify({ hosts }),
      });
    expect(
      (await POST(request([]), { params: Promise.resolve({ id: "run" }) }))
        .status,
    ).toBe(400);
    expect(
      (
        await POST(request(["new.example.test"]), {
          params: Promise.resolve({ id: "run" }),
        })
      ).status,
    ).toBe(200);
    expect(m.create).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        create: expect.objectContaining({
          programId: "program",
          normalizedValue: "new.example.test",
        }),
      }),
    );
  });
  it("does not propose an authorized host and adding it again is idempotent", async () => {
    m.assets = [
      {
        normalizedValue: "new.example.test",
        format: "SUBDOMAIN",
        active: true,
      },
    ];
    m.program.scopeAssets = m.assets as never;
    expect((await discoveredScopeCandidates("owner", "run"))[0].state).toBe(
      "authorized",
    );
    await addDiscoveredScope("owner", "run", ["new.example.test"]);
    expect(m.create).not.toHaveBeenCalled();
    m.program.scopeAssets = [];
  });
  it("refuses out-of-scope or forged discoveries", async () => {
    await expect(
      addDiscoveredScope("owner", "run", ["blocked.example.test"]),
    ).rejects.toThrow("out of scope");
    await expect(
      addDiscoveredScope("owner", "run", ["forged.example.test"]),
    ).rejects.toThrow("not discovered");
    expect(m.create).not.toHaveBeenCalled();
  });
});
