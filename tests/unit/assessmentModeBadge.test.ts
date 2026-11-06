import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
describe('minimal Target UI',()=>{it('has no current assessment configuration or badge',()=>{
 for(const file of ['src/components/TargetSettings.tsx','src/app/(dashboard)/targets/page.tsx','src/app/(dashboard)/targets/[id]/page.tsx']) {
 const text=readFileSync(file,'utf8');expect(text).not.toContain('AssessmentSettings');expect(text).not.toContain('AssessmentModeBadge');
 }
});});
