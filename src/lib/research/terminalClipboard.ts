/** False skips xterm's control-key handling, without cancelling the browser's
 * native copy/paste event. xterm already handles that event (including bracketed
 * paste and newline normalization); never also read/paste the clipboard here. */
export function terminalHandlesKey(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'isComposing'>, hasSelection: boolean): boolean {
  if (event.isComposing || event.altKey || event.ctrlKey === event.metaKey) return true;
  const key = event.key.toLowerCase();
  if (key === 'v') return false;
  if (key === 'c' && (event.metaKey || hasSelection)) return false;
  // In particular, Ctrl+C without a selection still sends ETX to the PTY.
  return true;
}
