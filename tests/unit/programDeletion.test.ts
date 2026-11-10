import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  exists: true,
  sessions: [] as {
    id: string;
    workspaceId: string;
    targetId: string;
    publicationManifest: null;
  }[],
  remove: vi.fn(),
  revoke: vi.fn(),
  purge: vi.fn(),
  deleteTarget: vi.fn(),
  deleteSessions: vi.fn(),
  deleteReport: vi.fn(),
  deleteScope: vi.fn(),
  tombstone: vi.fn(),
  fail: false,
}));
vi.mock("@/server/research/workspaceCleanup", () => ({
  revokeWorkspace: m.revoke,
  removeWorkspace: m.remove,
}));
vi.mock("@/server/queue/scanCancellation", () => ({
  requestScanCancellation: vi.fn(),
  settleQueuedCancellations: vi.fn(),
}));
vi.mock("@/server/queue/scanQueue", () => ({ purgeScanJobs: m.purge }));
vi.mock("@/lib/prisma", () => {
  const db = {
    $queryRaw: vi.fn(async () => (m.exists ? [{ id: "program" }] : [])),
    bountyProgram: {
      update: m.tombstone,
      findFirst: vi.fn(async () => ({ id: "program", state: "BLOCKED" })),
      delete: vi.fn(async () => {
        m.exists = false;
      }),
    },
    target: {
      findMany: vi.fn(async () => [
        { id: "host", scopeId: "scope", userId: "owner" },
      ]),
      deleteMany: m.deleteTarget,
    },
    scanRun: { findMany: vi.fn(async () => []), count: vi.fn(async () => 0) },
    researchSession: {
      findMany: vi.fn(async () => m.sessions),
      deleteMany: m.deleteSessions,
    },
    targetReconRun: { updateMany: vi.fn() },
    reconSummary: { updateMany: vi.fn() },
    finding: { findMany: vi.fn(async () => []), count: vi.fn() },
    report: { deleteMany: m.deleteReport },
    researchFindingPromotion: { deleteMany: vi.fn() },
    scope: { deleteMany: m.deleteScope },
    oobHit: { deleteMany: vi.fn() },
  };
  return {
    prisma: {
      ...db,
      $transaction: async (fn: (tx: unknown) => unknown) => fn(db),
    },
  };
});
import { deleteProgram } from "@/server/programDeletion";
describe("Target deletion without Research runtime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.exists = true;
    m.sessions = [];
    m.remove.mockResolvedValue(undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new Error("research-console unavailable");
      }),
    );
  });
  it("deletes a BLOCKED Target and is idempotent", async () => {
    await deleteProgram("owner", "program");
    await deleteProgram("owner", "program");
    expect(m.deleteTarget).toHaveBeenCalledExactlyOnceWith({
      where: { id: { in: ["host"] } },
    });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("deletes historical ResearchSession resources without any HTTP call", async () => {
    m.sessions = [
      {
        id: "old",
        workspaceId: "research_host",
        targetId: "host",
        publicationManifest: null,
      },
    ];
    await deleteProgram("owner", "program");
    expect(m.remove).toHaveBeenCalledWith(expect.any(String), "research_host");
    expect(m.deleteSessions).toHaveBeenCalledWith({
      where: { targetId: { in: ["host"] } },
    });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("resumes a deletion interrupted after its tombstone", async () => {
    m.sessions = [
      {
        id: "old",
        workspaceId: "research_host",
        targetId: "host",
        publicationManifest: null,
      },
    ];
    m.remove.mockRejectedValueOnce(new Error("interrupted"));
    await expect(deleteProgram("owner", "program")).rejects.toThrow(
      "interrupted",
    );
    expect(m.exists).toBe(true);
    await deleteProgram("owner", "program");
    expect(m.exists).toBe(false);
    expect(m.tombstone).toHaveBeenCalledTimes(2);
  });
  it("keeps shared scopes and reports belonging to other Targets", async () => {
    await deleteProgram("owner", "program");
    expect(m.deleteScope).toHaveBeenCalledWith({
      where: { id: { in: ["scope"] }, userId: "owner", targets: { none: {} } },
    });
    expect(m.deleteReport).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          NOT: {
            items: { some: { finding: { targetId: { notIn: ["host"] } } } },
          },
        }),
      }),
    );
  });
});
