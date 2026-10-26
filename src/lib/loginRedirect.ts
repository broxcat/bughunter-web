/** The UI may only route back to a relative path inside this application. */
export function safeLoginRedirect(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u0020\u007f]/.test(value)) return "/targets";
  try { return new URL(value, "https://bughunter.invalid").origin === "https://bughunter.invalid" ? value : "/targets"; } catch { return "/targets"; }
}
