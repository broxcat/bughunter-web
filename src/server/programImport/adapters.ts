
import { z } from 'zod';
import { normalizeProgram, type RawAsset, type Rule } from './normalize';
import { handlePattern, ImportUnavailable, requireAvailable, type ProgramImporter, type Reader } from './types';

const nullableText = z.string().nullish();
const strings = z.array(z.string()).max(1000);
const record = z.record(z.string(), z.unknown());
const envelope = <T extends z.ZodType>(schema: T) => z.object({ data: schema });
const h1Base = '/v1/hackers/programs/';
const bcBase = '/v1/engagements';
const intBase = '/external/researcher/v1/programs';
const excludedSlugs = new Set(['admin', 'api', 'auth', 'bugs', 'directory', 'engagements', 'hacktivity', 'login', 'logout', 'programs', 'reports', 'settings', 'signup', 'users', 'invitations']);

const makeRule = (text?: string | null, label?: string): Rule[] => text?.trim() ? [{ text: label ? label + ': ' + text : text }] : [];

function kind(type: string, webTypes: readonly string[]): RawAsset['kind'] {
  const value = type.toLowerCase().trim();
  if (webTypes.includes(value)) return 'WEB';
  if (/^(?:ios|android|apple_store_app_id|apple_store_app|google_play_app_id|google_play_app|windows_app_store_app_id|mobile(?:[ _-]app(?:lication)?)?|executable|source[ _-]code|code[ _-]repository|hardware|firmware|iot|smart[ _-]contract|ip[ _-](?:address|range)|cidr|downloadable_executables)(?:[ _-](?:app|application))?$/.test(value)) return 'NON_WEB';
  return 'UNKNOWN';
}

async function h1Pages(read: Reader, path: string) {
  const rows: unknown[] = [];
  for (let page = 1; page <= 12; page++) {
    const response = z.object({
      data: z.array(z.unknown()).max(100),
      links: z.object({ next: z.string().nullish() }).optional(),
    }).parse(await read(path + '?page%5Bsize%5D=100&page%5Bnumber%5D=' + page));
    rows.push(...response.data);
    // Upstream links are never followed. Page numbers are constructed locally.
    if (!response.links?.next) return rows;
  }
  throw new ImportUnavailable('manual');
}

export const hackerOne: ProgramImporter = {
  platform: 'HACKERONE',
  detect(url) {
    const handle = /^\/([A-Za-z0-9_-]+)\/?$/.exec(url.pathname)?.[1];
    return url.hostname === 'hackerone.com' && handle && handlePattern.test(handle) && !excludedSlugs.has(handle.toLowerCase())
      ? { platform: 'HACKERONE', handle, url: 'https://hackerone.com/' + handle } : null;
  },
  async fetchProgram(reference, read) {
    const result = envelope(z.object({
      id: z.union([z.string(), z.number()]),
      attributes: z.object({ handle: z.string(), name: z.string().min(1), state: z.string(), policy: nullableText, open_scope: z.boolean().optional() }),
    })).parse(await read(h1Base + reference.handle)).data;
    const a = result.attributes;
    requireAvailable(a.handle === reference.handle);
    const rules = makeRule(a.policy);
    if (a.open_scope) rules.push({ text: 'HackerOne reports an open scope policy. Review the program wording before adding assets.' });
    if (!a.policy?.trim()) rules.push({ text: 'Review the HackerOne program policy manually.' });
    return { id: String(result.id), name: a.name, rules };
  },
  async fetchScope(reference, _program, read) {
    const items = await h1Pages(read, h1Base + reference.handle + '/structured_scopes');
    return items.map(item => {
      const { id, attributes: asset } = z.object({
        id: z.string(),
        attributes: z.object({ asset_identifier: z.string(), asset_type: z.string(), eligible_for_submission: z.boolean().optional(), instruction: nullableText }),
      }).parse(item);
      return {
        id, value: asset.asset_identifier, type: asset.asset_type, instruction: asset.instruction,
        kind: kind(asset.asset_type, ['url', 'domain', 'wildcard', 'api']),
        disposition: asset.eligible_for_submission === false ? 'OUT' : asset.eligible_for_submission === true ? 'IN' : 'UNKNOWN',
      };
    });
  },
  async fetchRules(reference, program, read) {
    const exclusions = envelope(z.array(z.unknown()).max(1000)).parse(await read(h1Base + reference.handle + '/scope_exclusions')).data;
    return [...program.rules ?? [], ...exclusions.map(item => {
      const { attributes } = z.object({ attributes: z.object({ category: z.string(), details: nullableText }) }).parse(item);
      return { text: 'HackerOne reward exclusion: ' + attributes.category + (attributes.details ? ' — ' + attributes.details : ''),
        nonQualifyingLabel: attributes.details?.trim() ? undefined : attributes.category };
    })];
  },
  normalize: normalizeProgram,
};

export const bugcrowd: ProgramImporter = {
  platform: 'BUGCROWD',
  detect(url) {
    const handle = /^\/(?:engagements\/)?([A-Za-z0-9_-]+)\/?$/.exec(url.pathname)?.[1];
    return url.hostname === 'bugcrowd.com' && handle && handlePattern.test(handle) && !excludedSlugs.has(handle.toLowerCase())
      ? { platform: 'BUGCROWD', handle, url: 'https://bugcrowd.com/engagements/' + handle } : null;
  },
  async fetchProgram(reference, read) {
    for (let offset = 0; offset < 1200; offset += 100) {
      const page = z.object({
        data: z.array(z.object({
          id: z.uuid(), type: z.literal('engagement'),
          attributes: z.object({ code: z.string(), name: nullableText, state: z.string(), is_demo: z.boolean().optional() }),
        })).max(100),
        pagination: z.object({ has_more: z.boolean() }),
      }).parse(await read(bcBase + '?limit=100&offset=' + offset));
      const item = page.data.find(row => row.attributes.code === reference.handle);
      if (item?.attributes.name && item.attributes.state === 'in_progress' && !item.attributes.is_demo) {
        return { id: item.id, name: item.attributes.name };
      }
      if (item || !page.pagination.has_more) break;
    }
    throw new ImportUnavailable('manual');
  },
  async fetchScope(_reference, program, read) {
    const asset = z.object({ id: z.uuid().optional(), type: z.string(), value: nullableText, description: nullableText, reason: nullableText });
    const data = z.object({
      engagement_id: z.uuid(), in_scope: z.array(asset).max(1000), out_of_scope: z.array(asset).max(1000),
      vrt_exclusions: z.array(z.object({
        vrt_ids: z.array(z.object({ id: z.string(), version: z.string() })).max(100),
        exclusion_type: z.enum(['conditional', 'out_of_scope']), all_targets: z.boolean(), notes: nullableText,
        targets: z.array(z.object({ id: z.string(), name: nullableText })).optional(),
        target_groups: z.array(record).optional(),
      })).max(1000),
    }).parse(await read(bcBase + '/' + program.id + '/scope'));
    requireAvailable(data.engagement_id === program.id && !data.in_scope.some(asset => asset.value === 'REDACTED'));
    const rules: Rule[] = [{ text: 'Review the published Bugcrowd brief manually for engagement rules. The Hacker API scope response does not contain the full brief.' }];
    for (const rule of data.vrt_exclusions) {
      const text = 'Bugcrowd VRT ' + rule.exclusion_type + ': ' + rule.vrt_ids.map(vrt => vrt.version + '/' + vrt.id).sort().join(', ') + (rule.notes ? ' — ' + rule.notes : '');
      for (const target of rule.targets ?? []) rules.push({ assetRef: target.id, text });
      if (rule.all_targets || !rule.targets?.length || rule.target_groups?.length) {
        const groups = rule.target_groups?.map(group => String(group.name ?? group.id ?? '')).filter(Boolean).sort() ?? [];
        const labels = rule.all_targets && !groups.length && !rule.notes?.trim() && rule.exclusion_type === 'out_of_scope' ? rule.vrt_ids : [];
        if (labels.length) for (const vrt of labels) rules.push({ text: 'Bugcrowd VRT exclusion: ' + vrt.id, nonQualifyingLabel: vrt.id.split('.').at(-1) });
        else rules.push({ text: text + (groups.length ? ' (target groups: ' + groups.join(', ') + ')' : '') });
      }
    }
    program.rules = rules;
    return ([['IN', data.in_scope], ['OUT', data.out_of_scope]] as const).flatMap(([disposition, assets]) =>
      assets.map(row => ({
        id: row.id, value: row.value ?? null, type: row.type, disposition,
        kind: kind(row.type, ['website', 'api', 'domain', 'wildcard', 'url']),
        instruction: [row.description, row.reason].filter(Boolean).join('\n'),
      })));
  },
  async fetchRules(_reference, program) { return program.rules ?? []; },
  normalize: normalizeProgram,
};

const enumeration = z.object({ id: z.number().int(), value: z.string() });
const intIdentity = z.object({
  id: z.uuid(), handle: z.string(), name: z.string().min(1), confidentialityLevel: enumeration,
  webLinks: z.object({ detail: z.string() }),
});
export const intigriti: ProgramImporter = {
  platform: 'INTIGRITI',
  detect(url) {
    const match = /^\/programs\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)(?:\/detail)?\/?$/.exec(url.pathname);
    if (url.hostname !== 'app.intigriti.com' || !match || !match.slice(1).every(part => handlePattern.test(part))) return null;
    return { platform: 'INTIGRITI', handle: match[2], url: 'https://app.intigriti.com/programs/' + match[1] + '/' + match[2] + '/detail' };
  },
  async fetchProgram(reference, read) {
    let id: string | undefined;
    for (let offset = 0; offset < 3000; offset += 500) {
      const page = z.object({
        maxCount: z.number().int().nonnegative(), records: z.array(intIdentity).max(500),
      }).parse(await read(intBase + '?limit=500&offset=' + offset));
      const match = page.records.find(row => row.handle === reference.handle && row.webLinks.detail === reference.url);
      if (match) { id = match.id; break; }
      if (!page.records.length || offset + page.records.length >= page.maxCount) break;
    }
    if (!id) throw new ImportUnavailable('manual');
    const detail = intIdentity.extend({
      domains: z.object({ content: z.array(z.object({
        id: z.uuid(), type: enumeration, tier: enumeration, endpoint: z.string(), description: nullableText,
        requiredSkills: z.array(z.object({ name: z.string() })).optional(),
      })).max(1000).nullable() }),
      rulesOfEngagement: z.object({ content: z.object({
        description: nullableText,
        safeHarbour: z.boolean().optional(),
        testingRequirements: z.object({ intigritiMe: z.boolean().optional(), automatedTooling: z.number().int().nullish(), userAgent: nullableText, requestHeader: nullableText }).nullish(),
      }).nullish(), attachments: z.array(z.object({ url: z.string(), code: z.number() })).optional() }).nullish(),
    }).parse(await read(intBase + '/' + id));
    requireAvailable(detail.id === id && detail.handle === reference.handle && detail.webLinks.detail === reference.url &&
      detail.domains.content !== null);
    const rules = makeRule(detail.rulesOfEngagement?.content?.description);
    const engagement = detail.rulesOfEngagement;
    if (engagement?.content?.safeHarbour !== undefined) rules.push({ text: 'Intigriti safe harbour: ' + engagement.content.safeHarbour });
    for (const attachment of engagement?.attachments ?? []) rules.push({ text: 'Intigriti rules attachment (review manually): ' + attachment.url });
    const requirements = engagement?.content?.testingRequirements;
    if (!detail.rulesOfEngagement?.content) rules.push({ text: 'Review Intigriti rules of engagement manually.' });
    if (requirements?.intigritiMe) rules.push({ text: 'Intigriti email alias required.' });
    if (requirements?.automatedTooling != null) rules.push({ text: 'Intigriti automated tooling requirement: ' + requirements.automatedTooling });
    rules.push(...makeRule(requirements?.userAgent, 'User-Agent'), ...makeRule(requirements?.requestHeader, 'Required header'));
    return { id, name: detail.name, rules, assets: detail.domains.content!.map(row => {
      const tier = row.tier.value.toLowerCase().trim();
      return {
        id: row.id, value: row.endpoint, type: row.type.value,
        instruction: [row.description, ...(row.requiredSkills ?? []).map(skill => 'Required skill: ' + skill.name).sort()].filter(Boolean).join('\n'),
        kind: kind(row.type.value, ['domain', 'wildcard', 'url', 'website', 'web application', 'api']),
        disposition: tier === 'out of scope' ? 'OUT' : /^tier [1-5]$/.test(tier) || tier === 'no bounty' ? 'IN' : 'UNKNOWN',
      };
    }) };
  },
  async fetchScope(_reference, program) { return program.assets!; },
  async fetchRules(_reference, program) { return program.rules ?? []; },
  normalize: normalizeProgram,
};

export const yesWeHack: ProgramImporter = {
  platform: 'YESWEHACK',
  detect(url) {
    const handle = /^\/programs\/([A-Za-z0-9_-]+)\/?$/.exec(url.pathname)?.[1];
    return url.hostname === 'yeswehack.com' && handle && handlePattern.test(handle) && !excludedSlugs.has(handle.toLowerCase())
      ? { platform: 'YESWEHACK', handle, url: 'https://yeswehack.com/programs/' + handle } : null;
  },
  async fetchProgram(reference, read) {
    const data = z.object({
      slug: z.string(), title: z.string().min(1), public: z.boolean(), archived: z.boolean().optional(), disabled: z.boolean().optional(), demo: z.boolean().optional(),
      scopes: z.array(z.object({ scope: z.string(), scope_type: z.string(), description: nullableText, instruction: nullableText })).max(1000),
      out_of_scope: strings.nullish(), non_qualifying_vulnerability: strings.nullish(), qualifying_vulnerability: strings.nullish(),
      rules: nullableText, account_access: nullableText, user_agent: nullableText,
    }).parse(await read('/programs/' + reference.handle));
    requireAvailable(data.public && data.slug === reference.handle && !data.archived && !data.disabled && !data.demo);
    const rules = [
      ...makeRule(data.rules), ...makeRule(data.account_access, 'Account access'), ...makeRule(data.user_agent, 'User-Agent'),
      ...(data.non_qualifying_vulnerability ?? []).filter(value => value.trim()).map(value => ({ text: 'Non-qualifying vulnerability: ' + value, nonQualifyingLabel: value })),
      ...(data.qualifying_vulnerability ?? []).flatMap(value => makeRule(value, 'Qualifying vulnerability')),
    ];
    if (!data.rules?.trim()) rules.push({ text: 'Review YesWeHack program rules manually.' });
    const assets: RawAsset[] = data.scopes.map(row => ({
      value: row.scope, type: row.scope_type, kind: kind(row.scope_type, ['web-application', 'api', 'wildcard', 'domain']),
      disposition: 'IN', instruction: [row.description, row.instruction].filter(Boolean).join('\n'),
    }));
    for (const value of data.out_of_scope ?? []) assets.push({ value, type: 'out_of_scope', kind: 'UNKNOWN', disposition: 'OUT' });
    return { id: data.slug, name: data.title, rules, assets };
  },
  async fetchScope(_reference, program) { return program.assets!; },
  async fetchRules(_reference, program) { return program.rules ?? []; },
  normalize: normalizeProgram,
};
