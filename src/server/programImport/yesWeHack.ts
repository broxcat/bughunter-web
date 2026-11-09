import { DomUtils } from 'htmlparser2';
import type { parseDocument } from 'htmlparser2';
import { z } from 'zod';
import type { ProgramRewards, ProgramSections } from '@/lib/targetReviewData';

const severities = ['low', 'medium', 'high', 'critical'] as const;
const assetTier = /^(?:very low|low|medium|high|critical|default)$/i;
const tier = z.object({
  bounty_low: z.number().nonnegative().nullish(), bounty_medium: z.number().nonnegative().nullish(),
  bounty_high: z.number().nonnegative().nullish(), bounty_critical: z.number().nonnegative().nullish(),
});
const visibleProgram = z.looseObject({
  slug: z.string(), title: z.string().trim().min(1).max(200), public: z.literal(true),
  archived: z.boolean().optional(), disabled: z.boolean().optional(), bounty: z.boolean(),
  rules: z.string().nullish(), business_unit: z.object({ currency: z.string().regex(/^[A-Z]{3}$/) }),
  scopes: z.array(z.object({ scope: z.string(), scope_type: z.string(), asset_value: z.string().nullish() })).max(3000),
  out_of_scope: z.array(z.string()), qualifying_vulnerability: z.array(z.string()), non_qualifying_vulnerability: z.array(z.string()),
  user_agent: z.string().nullish(), vpn_active: z.boolean().optional(),
});

type Scope = { value: string; type: string; assetValue?: string };
export type YesWeHackFields = {
  name: string;
  scopes: Scope[];
  sections: ProgramSections;
  nonQualifying: string[];
  rewards: ProgramRewards;
  userAgent: { value: string; mode?: 'APPEND' } | null;
  needsVpn?: boolean;
};

const cleanList = (values: string[]) => [...new Set(values.map(value => value.trim().replace(/\s+/g, ' ')).filter(Boolean))];

function rewardsFromRows(currency: string, rows: (number | null)[][]): ProgramRewards {
  const amounts = severities.map((_, index) => {
    const values = rows.map(row => row[index]).filter((value): value is number => value != null);
    return values.length ? Math.max(...values) : null;
  });
  return { currency, low: amounts[0], medium: amounts[1], high: amounts[2], critical: amounts[3] };
}

export function yesWeHackPageData(document: ReturnType<typeof parseDocument>, handle: string): YesWeHackFields | null | undefined {
  const state = DomUtils.getElementById('ng-state', document.children);
  if (state?.name !== 'script' || state.attribs.type !== 'application/json') return undefined;
  let payload: unknown;
  try {
    const data = JSON.parse(DomUtils.textContent(state));
    payload = data['getProgram-' + JSON.stringify({ 0: handle })]?.data;
  } catch { return null; }
  if (payload === undefined) return undefined;
  const result = visibleProgram.safeParse(payload);
  if (!result.success || result.data.slug !== handle || result.data.archived || result.data.disabled) return null;
  const page = result.data;
  const rows = (suffix: string[]) => suffix.flatMap(value => {
    const grid = tier.safeParse(page['reward_grid_' + value]).data;
    if (!grid) return [];
    const amounts = [grid.bounty_low, grid.bounty_medium, grid.bounty_high, grid.bounty_critical].map(value => value ?? null);
    return amounts.some(value => value !== null) ? [amounts] : [];
  });
  const activeTiers = [...new Set(page.scopes.map(scope => scope.asset_value?.toLowerCase()).filter((value): value is string => Boolean(value)))];
  const grid = page.bounty ? rows(activeTiers) : [];
  const userAgent = page.user_agent?.trim();
  return {
    name: page.title, scopes: page.scopes.map(scope => ({ value: scope.scope, type: scope.scope_type, assetValue: scope.asset_value ?? undefined })),
    sections: { description: page.rules ?? '', outOfScope: cleanList(page.out_of_scope), qualifying: cleanList(page.qualifying_vulnerability) },
    nonQualifying: cleanList(page.non_qualifying_vulnerability),
    rewards: rewardsFromRows(page.business_unit.currency, grid.length || !page.bounty ? grid : rows(['default'])),
    userAgent: userAgent ? { value: userAgent, mode: 'APPEND' } : null,
    needsVpn: page.vpn_active === true,
  };
}

const heading = (line: string) => line.trim().replace(/^#{1,6}\s+/, '').replace(/:$/, '').replace(/^\*\*|\*\*$/g, '').trim().toLowerCase();
const stripBullet = (line: string) => line.replace(/^\s*(?:[-+*•]\s+|\d+[.)]\s+)/, '').trim();
function literalScope(text: string) {
  const value = stripBullet(text).replace(/^`(.*?)`$/, '$1');
  const link = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/.exec(value);
  if (link && link[1] === link[2]) return link[1];
  return value.replace(/^<(https?:\/\/[^>\s]+)>$/, '$1');
}
const cells = (line: string) => !line.startsWith('|') && line.includes('\t') ? line.split(/\t+/).map(cell => cell.trim())
  : line.includes('|') ? line.replace(/^\||\|$/g, '').split('|').map(cell => cell.trim()) : [];
const scopeType = /^(?:api|web application|website|wildcard|other|application|(?:mobile(?: application)?[ -]?)?(?:ios|android)|mobile application|ip(?: address| range)?|cidr|source code)(?:\b.*)?$/i;
const closingHeading = /^(?:hunting requirements|hunters collaboration|reports? of leaks and exposed credentials|user[ -]agent|account access|vpn)$/i;
const amount = /(?:€|\$|£|\b(?:EUR|USD|GBP|CHF|SGD|AUD|CAD|SEK|NOK|DKK)\b)\s*([\d][\d ,.\u00a0\u202f]*\d|\d)|([\d][\d ,.\u00a0\u202f]*\d|\d)\s*(?:€|\$|£|\b(?:EUR|USD|GBP|CHF|SGD|AUD|CAD|SEK|NOK|DKK)\b)/i;

function money(value: string) {
  const match = amount.exec(value);
  if (!match) return null;
  const digits = (match[1] ?? match[2]).trim().replace(/[\s\u00a0\u202f]/g, '');
  const decimal = /[,.]\d{1,2}$/.test(digits);
  const normalized = decimal ? digits.replace(/[,.](?=.*[,.])/g, '').replace(',', '.') : digits.replace(/[,.]/g, '');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function rawRewards(grid: string[], summary: string[]) {
  const joined = [...grid, ...summary].join('\n');
  const currency = /\b(EUR|USD|GBP|CHF|SGD|AUD|CAD|SEK|NOK|DKK)\b/i.exec(joined)?.[1].toUpperCase() ??
    (joined.includes('€') ? 'EUR' : joined.includes('$') ? 'USD' : joined.includes('£') ? 'GBP' : 'EUR');
  const rows: (number | null)[][] = [];
  for (const [index, line] of grid.entries()) {
    const row = cells(line);
    if (row.length >= 5 && assetTier.test(row[0])) rows.push(row.slice(1, 5).map(money));
    else if (assetTier.test(line) && grid.length - index > 4) {
      const amounts = grid.slice(index + 1, index + 5);
      if (amounts.every(item => money(item) !== null || /^[-–—]$/.test(item))) rows.push(amounts.map(money));
    }
  }
  if (!rows.length) {
    const parts = summary.join(' ').split(/\b(Low|Medium|High|Critical)\b/i);
    const compact = new Map<string, number | null>();
    for (let index = 1; index < parts.length; index += 2) compact.set(parts[index].toLowerCase(), money(parts[index - 1]));
    const amounts = severities.map(level => compact.get(level) ?? null);
    if (amounts.some(value => value !== null)) rows.push(amounts);
  }
  return rewardsFromRows(currency, rows);
}

function rawScopes(lines: string[]): Scope[] {
  const scopes: Scope[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const row = cells(line);
    // Compound scope expressions may contain literal pipes. Locate the
    // type/asset-value columns from the right and retain the whole value.
    const typeColumn = row.findLastIndex((cell, index) => index > 0 && scopeType.test(cell) &&
      (index === row.length - 1 || !row[index + 1] || assetTier.test(row[index + 1])));
    if (typeColumn > 0 && row[0]) {
      const value = row.slice(0, typeColumn).join(!line.startsWith('|') && line.includes('\t') ? '\t' : '|').replace(/\\\|/g, '|');
      scopes.push({ value: literalScope(value), type: row[typeColumn], assetValue: row[typeColumn + 1] });
      continue;
    }
    if (row.length) continue;
    const next = lines[index + 1] ?? '';
    if (scopeType.test(next) && (line.includes('.') || !/^scope$/i.test(line)) && !/^(?:type|asset value)$/i.test(line)) {
      const priority = lines[index + 2];
      scopes.push({ value: literalScope(line), type: next, assetValue: priority && assetTier.test(priority) ? priority : undefined });
      index += priority && assetTier.test(priority) ? 2 : 1;
    } else if (/^(?:[-+*•]\s+)(?:https?:\/\/|\*\.|[\w-]+\.[\w.\-]+)/.test(line)) {
      // A copied in-scope list may omit the table's type column. Only exact
      // network-shaped entries are eligible, never sentences or examples.
      const value = stripBullet(line).replace(/^`(.*?)`$/, '$1');
      if (!/\s/.test(value)) scopes.push({ value, type: value.startsWith('*.') ? 'wildcard' : 'web-application' });
    }
  }
  return scopes;
}

function requiredAgent(lines: string[]): YesWeHackFields['userAgent'] {
  const text = lines.join(' ');
  const appendix = /\bappend\b.*?\b(?:value|following)\s*:\s*(?:['"]\s*)?(.+?)(?:\s*['"]\.?\s*$|\.?\s*$)/i.exec(text)?.[1].trim();
  if (appendix) return { value: appendix, mode: 'APPEND' };
  const exact = /^(?:required\s+)?user[ -]agent\s*:\s*(.+)$/i.exec(text)?.[1]?.trim();
  if (exact) return { value: exact };
  return text && !/[\n\r]/.test(text) && text.length <= 512 && !/\b(?:must|required|header|set|append)\b/i.test(text)
    ? { value: text } : null;
}

export function parseYesWeHackRaw(source: string, explicitPlatform = false): YesWeHackFields | null {
  const lines = source.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const labels = lines.map(heading);
  const scope = labels.findLastIndex(label => ['scopes', 'in scope', 'in-scope'].includes(label));
  const qualifying = labels.findLastIndex(label => label === 'qualifying vulnerabilities');
  const non = labels.findLastIndex(label => /^non[- ]qualifying vulnerabilities$/.test(label));
  const reward = labels.findLastIndex((label, index) => label === 'reward' && index < scope);
  if (scope < 0 || qualifying <= scope || non <= qualifying || reward < 0 && !explicitPlatform) return null;
  const outside = labels.findLastIndex((label, index) => index > scope && index < qualifying && /^out[ -]of[ -]scopes?$/.test(label));
  const types = labels.findIndex((label, index) => index > scope && index < qualifying && label === 'vulnerability types');
  const agent = labels.findLastIndex((label, index) => index > non && /^user[ -]agent$/.test(label));
  const end = (from: number, fallback: number) => {
    const found = labels.findIndex((label, index) => index > from && (closingHeading.test(label) || /^#{1,6}\s/.test(lines[index])));
    return found < 0 ? fallback : Math.min(found, fallback);
  };
  const firstReward = labels.indexOf('reward');
  const title = lines.find((line, index) => /^#\s+/.test(line) && (firstReward < 0 || index < firstReward));
  const publicMarker = labels.findIndex((label, index) => /^(?:bug bounty|vdp)\s*public$/.test(label) ||
    label === 'public' && /^(?:bug bounty|vdp)$/.test(labels[index - 1] ?? ''));
  const candidates = publicMarker >= 0 ? lines.slice(publicMarker + 1, firstReward < 0 ? undefined : firstReward)
    .filter(line => !/^(?:submit report|last update|program history)/i.test(line)) : [];
  const name = title?.replace(/^#\s+/, '') ?? candidates[0] ?? '';
  const marker = labels.indexOf('program description');
  const description = marker >= 0 && scope > marker ? lines.slice(marker + 1, reward > marker ? reward : scope)
    .filter(line => heading(line) !== 'program activity').join('\n') : '';
  const scopes = rawScopes(lines.slice(scope + 1, [outside, types, qualifying].filter(index => index > scope).sort((a, b) => a - b)[0]));
  const list = (start: number, stop: number) => cleanList(lines.slice(start + 1, stop).map(stripBullet).filter(line => line !== '-' && line !== '—'));
  return {
    name, scopes,
    sections: { description, outOfScope: outside < 0 ? [] : list(outside, types > outside ? types : qualifying), qualifying: list(qualifying, non) },
    nonQualifying: list(non, end(non, agent > non ? agent : lines.length)),
    rewards: rawRewards(reward >= 0 ? lines.slice(reward + 1, scope) : [], firstReward < 0 ? [] : lines.slice(firstReward + 1, firstReward + 8)),
    userAgent: agent < 0 ? null : requiredAgent(lines.slice(agent + 1, end(agent, lines.length))),
    needsVpn: labels.some((label, index) => index > non && label === 'vpn'),
  };
}
