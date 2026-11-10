import { describe, it, expect, vi } from "vitest";
import { testProviderConnection } from "@/server/brain/testConnection";
const input = {
  provider: "OPENAI" as const,
  model: "configured-model",
  baseUrl: "https://provider.example.test/v1",
  apiKey: "secret-must-not-leak",
};
describe("provider connection test", () => {
  it.each([
    [200, "Connected"],
    [401, "Invalid API key"],
    [403, "Invalid API key"],
    [404, "Model unavailable"],
    [429, "Provider returned HTTP 429"],
  ])(
    "classifies HTTP %s without returning provider content",
    async (status, result) => {
      const send = vi.fn(
        async () => new Response("secret-must-not-leak", { status }),
      );
      expect(await testProviderConnection(input, send)).toBe(result);
      expect(send.mock.calls).toHaveLength(1);
    },
  );
  it("classifies unreachable and timeout safely", async () => {
    expect(
      await testProviderConnection(
        input,
        vi.fn().mockRejectedValue(new Error(input.apiKey)),
      ),
    ).toBe("Endpoint unreachable");
    expect(
      await testProviderConnection(
        input,
        vi.fn().mockRejectedValue(new DOMException("secret", "TimeoutError")),
      ),
    ).toBe("Timeout");
  });
  it.each([
    "file:///etc/passwd",
    "https://user:secret@example.test",
    "bad url",
  ])("rejects invalid base URL %s before fetching", async (baseUrl) => {
    const send = vi.fn();
    expect(await testProviderConnection({ ...input, baseUrl }, send)).toBe(
      "Invalid base URL",
    );
    expect(send).not.toHaveBeenCalled();
  });
});
