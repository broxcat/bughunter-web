// Scanners need their runtime paths, locale and CA files, never the worker's
// database, encryption, AI-provider or target-session secrets. This is shared
// with the process supervisor so direct supervisor callers receive the same
// boundary. Passive tool configuration remains discoverable through HOME.
const allowed = new Set([
  'PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'LC_CTYPE',
  'SSL_CERT_FILE', 'SSL_CERT_DIR', 'NODE_EXTRA_CA_CERTS',
  'GOMAXPROCS', 'GOMEMLIMIT', 'GODEBUG',
  'SYSTEMROOT', 'SystemRoot', 'WINDIR', 'PATHEXT',
]);
/** @param {Record<string, string | undefined>} source @returns {NodeJS.ProcessEnv} */
export function scannerEnvironment(source = process.env) {
  return /** @type {NodeJS.ProcessEnv} */ (Object.fromEntries(Object.entries(source).filter(([name, value]) => allowed.has(name) && typeof value === 'string')));
}
