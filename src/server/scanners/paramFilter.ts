// Shared candidate-parameter filter. The injection scanners (SQLi, command
// injection, SSTI, and the URL collectors in IDOR/SSRF) discover "params" from
// page links; many of those are not real user-controllable inputs but
// framework-generated static-asset references — e.g. Next.js emits
// `/favicon.ico?favicon.2vob68tjqpejf.ico` and `/opengraph-image?<hash>`, whose
// query "key" is a cache-busting hash with no value. Testing those for SQLi/RCE
// is pure noise. isLikelyUserParam() excludes them before a candidate is formed.

const STATIC_ASSET_PATHS: RegExp[] = [
  /^\/_next\//i, // all Next.js build assets
  /^\/(favicon\.ico|robots\.txt|sitemap\.xml|manifest\.webmanifest)$/i,
  /^\/(opengraph-image|twitter-image|apple-icon|apple-touch-icon|icon)(\b|[-./])/i,
];

// A "key" that is really a filename/asset reference, not an app parameter name.
const ASSET_EXT_KEY = /\.(ico|png|jpe?g|svg|gif|webp|css|js|mjs|map|woff2?|ttf|eot|json|txt|xml|webmanifest)$/i;
// A long hex token — a cache-buster / content hash used as a keyless query.
const HASH_KEY = /^[0-9a-f]{8,}$/i;

/**
 * True when `paramKey` on `url` looks like a genuine user-controllable parameter
 * worth testing for injection; false for static-asset paths and
 * framework-generated cache-buster/hash "params".
 *
 * Pure and total — an unparseable URL returns false (nothing to test).
 */
export function isLikelyUserParam(url: string, paramKey: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }

  // 1) Static-asset paths are never injection surfaces.
  if (STATIC_ASSET_PATHS.some((re) => re.test(u.pathname))) return false;

  const key = paramKey.trim();
  if (!key) return false;

  // 2) A keyless query token (`?bd72c42…` → key present, value empty) is almost
  //    never a real application parameter.
  if (u.searchParams.get(key) === "") return false;

  // 3) The "key" is actually a filename/asset reference or a bare content hash.
  if (ASSET_EXT_KEY.test(key)) return false;
  if (HASH_KEY.test(key)) return false;

  return true;
}
