import { describe, it, expect } from "vitest";
import { exportText, workspacePath } from "@/server/research/workspace";

// Workspace export and ZIP download were retired with the Research console.
// Historical rows remain readable; these helpers still guard what is displayed.
describe("historical Research text and workspace identity", () => {
  it("redacts secret-bearing URLs and bearer/API token text", () => {
    const text = exportText("https://user:password@app.example.test/session/secret-value?key=private-query\nBearer private-bearer\nAPI_KEY=sk-private-key");
    expect(text).not.toMatch(/password|secret-value|private-query|private-bearer|sk-private-key/);
  });
  it("accepts only server workspace identities under an absolute root", () => {
    expect(workspacePath("/data/research", "0b7c1a2e-4c1d-4e5f-9a6b-1c2d3e4f5a6b")).toBe("/data/research/0b7c1a2e-4c1d-4e5f-9a6b-1c2d3e4f5a6b");
    expect(workspacePath("/data/research", "research_target")).toBe("/data/research/research_target");
    for (const id of ["../other", "research_../x", "not-a-uuid"]) expect(() => workspacePath("/data/research", id)).toThrow();
    expect(() => workspacePath("relative", "research_target")).toThrow();
  });
});
