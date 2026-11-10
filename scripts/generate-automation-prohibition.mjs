import { readFile, writeFile } from 'node:fs/promises';
import { automationProhibitionPattern, automationSentenceSeparator, automationSourcePaths } from '../src/lib/automationProhibition.mjs';
const path = new URL('../prisma/migrations/20261110150000_target_cascade_and_active_policy/migration.sql', import.meta.url);
export const generatedFunction = `-- BEGIN GENERATED AUTOMATION DETECTION (npm run policy:generate-detection)
CREATE OR REPLACE FUNCTION program_automation_prohibition(source TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $function$
  SELECT btrim(sentence) FROM regexp_split_to_table(coalesce(source, ''), $pattern$${automationSentenceSeparator}$pattern$)
    WITH ORDINALITY AS parts(sentence, position)
  WHERE sentence ~* $pattern$${automationProhibitionPattern}$pattern$
  ORDER BY position LIMIT 1
$function$;

CREATE OR REPLACE FUNCTION program_automation_source(program_rules TEXT, snapshot JSONB) RETURNS TEXT
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $function$
  SELECT concat_ws(chr(10), program_rules, (
    SELECT string_agg(field.value #>> '{}', chr(10) ORDER BY paths.position, field.ordinality)
    FROM unnest(ARRAY[${automationSourcePaths.map(path => "'" + path + "'").join(', ')}])
      WITH ORDINALITY AS paths(path, position)
    CROSS JOIN LATERAL jsonb_path_query(coalesce(snapshot, '{}'::jsonb), paths.path::jsonpath)
      WITH ORDINALITY AS field(value, ordinality)
    WHERE jsonb_typeof(field.value) = 'string'
  ))
$function$;
-- END GENERATED AUTOMATION DETECTION`;
const original = await readFile(path, 'utf8');
const next = original.replace(/-- BEGIN GENERATED AUTOMATION DETECTION[\s\S]*?-- END GENERATED AUTOMATION DETECTION/, generatedFunction);
if (process.argv.includes('--check')) {
  if (original !== next) { process.stderr.write('Generated automation detection is out of date. Run npm run policy:generate-detection.\n'); process.exitCode = 1; }
} else await writeFile(path, next);
