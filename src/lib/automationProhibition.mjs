import rules from './automationProhibitionRules.json' with { type: 'json' };

// The same portable expression is used by JS and the generated PostgreSQL
// function. Explicit boundaries avoid differing JS/SQL definitions of \b.
const subject = '(?:' + rules.subjects.join('|') + ')';
const prefix = '(?:' + rules.prefixes.join('|') + ')';
const suffix = '(?:' + rules.suffixes.join('|') + ')';
export const automationProhibitionPattern = '(^|[^a-zà-ÿ])(?:' + prefix + '\\s*(?:any\\s+)?' + subject + '|' + subject + '\\s+' + suffix + ')($|[^a-zà-ÿ])';
export const automationSentenceSeparator = rules.sentenceSeparator;
const prohibition = new RegExp(automationProhibitionPattern, 'i');
const separator = new RegExp(automationSentenceSeparator);
const mention = new RegExp(rules.mentionPattern, 'i');

/** Return source text, never a synthesized explanation of the program's rule. */
export function findAutomationProhibition(source = '') {
  return source.split(separator).map(sentence => sentence.trim()).find(sentence => prohibition.test(sentence)) ?? null;
}
export const explicitlyForbidsAutomation = (source = '') => findAutomationProhibition(source) !== null;
export const mentionsAutomation = (source = '') => mention.test(source);

/** Textual rules retained by historical and current imports. */
export function automationSourceText(programRules, snapshot = {}) {
  const values = rules.sourcePaths.flatMap(path => {
    let current = [snapshot];
    for (const key of path.slice(2).split('.')) {
      const array = key.endsWith('[*]');
      const property = array ? key.slice(0, -3) : key;
      current = current.flatMap(value => {
        const next = value?.[property];
        return array ? Array.isArray(next) ? next : [] : [next];
      });
    }
    return current;
  });
  return [...new Set([programRules, ...values].filter(value => typeof value === 'string' && value.trim()))].join('\n');
}
export const automationSourcePaths = rules.sourcePaths;
