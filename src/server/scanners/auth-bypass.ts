import type { ScanContext } from "./context";
import { runFamilyTechniques } from "@/server/hunt/runtime";
import type { ProbeResult } from "./http";
function looksEmpty(body: string): boolean {
  return body.replace(/\s+/g, "").length < 32;
}

export interface BypassVerdict {
  confidence: "PROVEN" | "CANDIDATE";
  reason: string;
}

const norm = (body: string): string => body.replace(/\s+/g, "");
const titleOf = (body: string): string | null => {
  const m = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1].trim().toLowerCase() : null;
};
const contentType = (p: ProbeResult): string =>
  (p.headers["content-type"] ?? "").toLowerCase();
// Markers that a JSON body is an error/empty shell rather than real resource data.
const JSON_ERROR_RE =
  /"(error|errors|message|detail|code)"\s*:|not\s*found|forbidden|unauthoriz|access denied/i;

/**
 * Decide whether a bypass technique's 401/403 -> 200 flip is a REAL bypass or a
 * false positive where the server simply served its default catch-all page.
 *
 * `target` is the response for the real path under the bypass technique; `catchAll`
 * is the response for a definitely-nonexistent path under the SAME technique (the
 * server's default/catch-all fingerprint). PROVEN only when the target response is
 * clearly distinct from the catch-all AND consistent with the targeted resource;
 * otherwise CANDIDATE with the reason. Pure + total (never throws).
 */
export function classifyBypassResponse(
  path: string,
  target: ProbeResult,
  catchAll: ProbeResult,
): BypassVerdict {
  const tct = contentType(target);
  const bothHtml = /text\/html/.test(tct) && /text\/html/.test(contentType(catchAll));
  const tTitle = titleOf(target.body);
  const cTitle = titleOf(catchAll.body);

  // (a) The 200 looks like the server's default catch-all page, not the resource.
  if (catchAll.status >= 200 && catchAll.status < 400) {
    const identical =
      norm(catchAll.body).length > 0 && norm(target.body) === norm(catchAll.body);
    const sameTitle = tTitle !== null && tTitle === cTitle;
    const sizeClose =
      catchAll.bodyLen > 0 &&
      Math.abs(target.bodyLen - catchAll.bodyLen) <=
        Math.max(64, catchAll.bodyLen * 0.15);
    if (identical || sameTitle || (bothHtml && sizeClose)) {
      return {
        confidence: "CANDIDATE",
        reason:
          `status flip observed but the response matches the server's default catch-all page ` +
          `(content-type ${tct || "?"}, ~${target.bodyLen} bytes` +
          `${sameTitle ? `, same <title> "${tTitle}"` : ""}) — not the targeted resource ${path}, ` +
          `likely false positive, verify manually`,
      };
    }
  }

  // (b) Distinct from the catch-all AND consistent with the targeted resource:
  //     a real JSON body (typical for an API path) with no error markers.
  const isJson = /application\/json|\+json/.test(tct);
  if (isJson && !looksEmpty(target.body) && !JSON_ERROR_RE.test(target.body.slice(0, 500))) {
    return {
      confidence: "PROVEN",
      reason:
        `response is JSON (${tct}) distinct from the catch-all page and consistent with the ` +
        `targeted resource — the access control is genuinely bypassed`,
    };
  }

  // (c) Ambiguous: differs from the catch-all but not confirmable as the resource.
  return {
    confidence: "CANDIDATE",
    reason: isJson
      ? `status flip to JSON (${tct}) but the body is empty or an error shell — not confirmed as the targeted resource, verify manually`
      : `status flip to ${tct || "an unknown content-type"}; response differs from the catch-all page but could not be confirmed as the targeted resource — verify manually`,
  };
}

/** Catalogue-only dispatcher: no legacy payloads or arbitrary scanner choice. */
export async function runAuthBypass(ctx: ScanContext): Promise<void> {
  await runFamilyTechniques(ctx, "auth-bypass");
}
