import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mutable control knobs shared with the hoisted mock factory. `vi.hoisted`
// makes them exist before `vi.mock` is lifted to the top of the module.
const ctrl = vi.hoisted(() => ({
  mode: "dialog" as "dialog" | "nodialog" | "launchthrow" | "navthrow",
  canary: "",
  navStatus: 200,
}));

// Fake Playwright: chromium.launch -> browser -> context -> page. No real
// browser or network. The page's goto() optionally invokes the registered
// "dialog" handler with a message carrying the canary, so we exercise only the
// confirmer's DECISION logic.
vi.mock("playwright-chromium", () => {
  const makePage = () => {
    let dialogHandler: ((d: unknown) => void) | null = null;
    return {
      on(event: string, cb: (d: unknown) => void) {
        if (event === "dialog") dialogHandler = cb;
      },
      async goto() {
        if (ctrl.mode === "navthrow") {
          throw new Error("net::ERR_CONNECTION_REFUSED");
        }
        if (ctrl.mode === "dialog" && dialogHandler) {
          dialogHandler({
            message: () => `alert fired :: ${ctrl.canary}`,
            dismiss: async () => {},
          });
        }
        return { status: () => ctrl.navStatus };
      },
      async close() {},
    };
  };
  const context = {
    async newPage() {
      return makePage();
    },
    async close() {},
  };
  const browser = {
    async newContext() {
      return context;
    },
    async close() {},
  };
  return {
    chromium: {
      async launch() {
        if (ctrl.mode === "launchthrow") {
          throw new Error("Failed to launch chromium binary");
        }
        return browser;
      },
    },
  };
});

// Imported AFTER the mock is declared (vi.mock is hoisted above this anyway).
import { confirmXssSink } from "@/server/scanners/xssConfirm";

afterEach(() => {
  vi.useRealTimers();
});

describe("confirmXssSink — dialog carrying the canary", () => {
  it("returns confirmed:true with evidence when a dialog fires with the canary", async () => {
    ctrl.mode = "dialog";
    ctrl.canary = "testcanaryABC123";
    ctrl.navStatus = 200;

    const result = await confirmXssSink("https://victim.example/page", {
      sink: "innerHTML =",
      location: "https://victim.example/app.js",
      canaryId: "testcanaryABC123",
    });

    expect(result.confirmed).toBe(true);
    expect(result.evidence).toBeDefined();
    expect(result.evidence).toContain("testcanaryABC123");
    expect(result.reason).toBeUndefined();
  });
});

describe("confirmXssSink — no dialog within the budget", () => {
  it("returns confirmed:false with a reason, never throws", async () => {
    ctrl.mode = "nodialog";
    ctrl.canary = "unused";
    ctrl.navStatus = 200;
    vi.useFakeTimers();

    const promise = confirmXssSink("https://victim.example/page", {
      sink: "document.write",
      canaryId: "whatever",
    });
    // Push past every grace window and the 12s overall deadline.
    await vi.advanceTimersByTimeAsync(14_000);
    const result = await promise;

    expect(result.confirmed).toBe(false);
    expect(result.reason).toBeDefined();
    expect(result.reason).toContain("no dialog/canary observed");
  });
});

describe("confirmXssSink — navigation/launch failures", () => {
  it("navigation throw -> confirmed:false, reason set, no throw", async () => {
    ctrl.mode = "navthrow";
    ctrl.canary = "unused";
    vi.useFakeTimers();

    const promise = confirmXssSink("https://unreachable.example/", {
      sink: "location sink",
      canaryId: "c",
    });
    await vi.advanceTimersByTimeAsync(14_000);
    const result = await promise;

    expect(result.confirmed).toBe(false);
    expect(result.reason).toBeDefined();
  });

  it("launch throw -> confirmed:false, reason mentions the failure, no throw", async () => {
    ctrl.mode = "launchthrow";
    ctrl.canary = "unused";

    // launch throws before any timer is scheduled, so real timers are fine.
    const result = await confirmXssSink("https://victim.example/", {
      sink: "innerHTML =",
      canaryId: "c",
    });

    expect(result.confirmed).toBe(false);
    expect(result.reason).toContain("browser launch/run failed");
  });
});

describe("confirmXssSink — input validation (no browser needed)", () => {
  beforeEach(() => {
    ctrl.mode = "launchthrow"; // ensure we'd notice if it tried to launch
  });

  it("rejects an unparseable URL without launching", async () => {
    const result = await confirmXssSink("not a url", { sink: "x", canaryId: "c" });
    expect(result.confirmed).toBe(false);
    expect(result.reason).toContain("invalid URL");
  });

  it("rejects a non-http(s) scheme", async () => {
    const result = await confirmXssSink("ftp://host/file", { sink: "x", canaryId: "c" });
    expect(result.confirmed).toBe(false);
    expect(result.reason).toContain("unsupported scheme");
  });
});
