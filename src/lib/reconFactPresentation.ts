import type { FactRowV3, FactualReportV3, ReconReportV3 } from './reconReportV3';
import { redactObservationText } from './observationSafety';

// Presentation only: never infer a protocol, response, version or authorization.
const text = (value: unknown): string => typeof value === 'string' || typeof value === 'number'
  ? redactObservationText(String(value)).replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, 4096) : '';
const human = (value: string) => value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ');
const list = (value: unknown) => Array.isArray(value) ? value.map(text).filter(Boolean).join(', ') : text(value);
const placeholder = (value: string, label: string) => !value || /^[-–—\s]+$/.test(value) || value.toLowerCase() === label.toLowerCase();

function staticUrl(row: FactRowV3): string | null {
  if (!row || !row.details || typeof row.details !== 'object' || Array.isArray(row.details)) return null;
  for (const candidate of [row.value, row.details.url, row.details.to]) {
    const value = text(candidate);
    if (!/^(?:https?:\/\/|\/)/i.test(value)) continue;
    try {
      const path = new URL(value, 'https://presentation.invalid').pathname;
      if (/\/(?:_next\/static|static\/chunks)\/|\.(?:js|mjs|css|png|jpe?g|gif|svg|ico|webp|woff2?|ttf|map)$/i.test(path)) return value;
    } catch { /* Unsupported historical values are handled by the formatter. */ }
  }
  return null;
}

/** A useful primary line for both historical and current application-owned rows. */
export function renderReconFact(row: FactRowV3): string | null {
  if (!row || !row.details || typeof row.details !== 'object' || Array.isArray(row.details) || staticUrl(row)) return null;
  const d = row.details, label = text(row.label).toLowerCase();
  const value = text(row.value), hostname = text(d.hostname) || text(d.host);
  const type = text(d.type), name = text(d.name), url = text(d.url) || value;
  const meaningfulValue = !placeholder(value, label) && value !== type ? value : '';
  if (label === 'relation') {
    const from = text(d.from), to = text(d.to);
    return from && to ? `${from} → ${to}${d.relationship ? ` (${human(text(d.relationship))})` : ''}` : meaningfulValue || null;
  }
  if (label === 'hostname' || type === 'dns-address') {
    const host = hostname || meaningfulValue, addresses = list(d.addresses) || list(d.ips) || text(d.ip);
    return host ? `${host}${addresses ? ` → ${addresses}` : ''}` : addresses || null;
  }
  if (label === 'port' || label === 'service') {
    const port = Number(d.port), validPort = Number.isInteger(port) && port > 0 && port <= 65535;
    const service = text(d.service) || name;
    const protocol = text(d.protocol);
    const socket = validPort ? `${port}${protocol ? `/${protocol}` : ''}` : '';
    return socket || service ? `${[socket, service].filter(Boolean).join(' — ')}${hostname ? ` (${hostname})` : ''}${d.state ? ` · ${text(d.state)}` : ''}` : null;
  }
  if (label === 'technology') {
    const technology = name || (value !== hostname ? meaningfulValue : '');
    const version = text(d.version);
    return technology ? `${technology}${version && version !== 'Not confirmed' ? ` ${version}` : ''}${hostname ? ` (${hostname})` : ''}` : null;
  }
  if (label === 'tls') {
    const properties = [text(d.tlsVersion), d.subject ? `Subject: ${text(d.subject)}` : '', d.issuer ? `Issuer: ${text(d.issuer)}` : '', d.validFrom ? `Valid from ${text(d.validFrom)}` : '', d.validTo ? `Valid until ${text(d.validTo)}` : ''].filter(Boolean);
    return properties.length || hostname || meaningfulValue ? `TLS${hostname || meaningfulValue ? ` — ${hostname || meaningfulValue}` : ''}${properties.length ? ` · ${properties.join(' · ')}` : ''}` : null;
  }
  if (type === 'redirect' || label === 'redirect') {
    const origin = text(d.origin), destination = text(d.redirect) || text(d.location) || (origin ? meaningfulValue : '');
    return destination || meaningfulValue ? `${origin || meaningfulValue || 'Redirect'}${destination ? ` → ${destination}` : ' — redirect observed'}` : null;
  }
  if (['endpoint', 'url', 'api-surface', 'auth-surface', 'content-discovery'].includes(label) || type === 'directory-discovery') {
    if (placeholder(url, label) || url === type) return text(d.description) || null;
    const method = text(d.method), status = Number(d.statusCode);
    const response = row.verification === 'OBSERVED' && Number.isInteger(status) && status >= 100 && status <= 599 ? String(status) : 'discovered';
    return `${method ? `${method} ` : ''}${url} — ${response}${d.contentType ? ` · ${text(d.contentType)}` : ''}${d.redirect ? ` → ${text(d.redirect)}` : ''}`;
  }
  if (label === 'coverage') {
    const capability = text(d.capability) || meaningfulValue;
    return capability ? [human(capability), text(d.state) || text(d.status), text(d.reason)].filter(Boolean).join(' — ') : null;
  }
  const description = text(d.description);
  if (description) return `${meaningfulValue ? `${meaningfulValue} — ` : ''}${description}`;
  if (d.classification) return `${human(type || label)} — ${human(text(d.classification))}${typeof d.sampleCount === 'number' ? ` (${d.sampleCount} samples)` : ''}`;
  if (meaningfulValue) return `${type ? `${human(type)} — ` : ''}${meaningfulValue}`;
  // A kind/type/evidenceState alone is metadata, not a displayable observation.
  return null;
}

export function presentReconFacts(factual: FactualReportV3) {
  const staticUrls = new Set<string>();
  const sections = factual.sections.map(section => ({ ...section, rows: section.rows.flatMap(row => {
    const asset = staticUrl(row);
    if (asset) { staticUrls.add(asset); return []; }
    const primary = renderReconFact(row);
    return primary ? [{ row, primary }] : [];
  }) })).filter(section => section.rows.length);
  return { sections, count: sections.reduce((total, section) => total + section.rows.length, 0), staticAssets: Math.max(factual.totals.staticAssets, staticUrls.size) };
}

/** Only expose diagnostic fields recorded by the application, never provider bodies. */
export function reconSynthesisPresentation(report: ReconReportV3) {
  const state = report.narrativeStatus === 'FACTUAL_ONLY' ? 'FALLBACK' : report.narrativeStatus === 'RECOVERED' ? 'READY_WITH_WARNINGS' : 'READY';
  const allowed = ['FAILED_PROVIDER', 'FAILED_SCHEMA', 'FAILED_VALIDATION', 'FAILED_PROVIDER_CONFIGURATION'];
  const failure = allowed.includes(String(report.narrativeFailure)) ? String(report.narrativeFailure) : undefined;
  const attempts = report.generation?.attempts;
  const diagnostics = Array.isArray(attempts) ? attempts.flatMap(item => {
    if (!item || typeof item !== 'object') return [];
    const entry = item as Record<string, unknown>, status = Number(entry.httpStatus);
    return Number.isInteger(status) && status >= 400 && status <= 599 ? [`HTTP ${status}`] : [];
  }) : [];
  return { state, failure, diagnostics: [...new Set(diagnostics)] };
}
