/** Browser mutations must come from the configured application origin.
 * Non-browser authenticated API clients may omit Origin. */
export function foreignOrigin(req: Request) {
  const origin = req.headers.get('origin');
  return origin !== null && origin !== new URL(process.env.AUTH_URL ?? req.url).origin;
}
