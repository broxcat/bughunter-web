import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe,expect,it } from 'vitest';
import AssessmentModeBadge from '@/components/AssessmentModeBadge';
describe('Target assessment mode badges',()=>{
  it.each([['BLACK_BOX','Black-box'],['WHITE_BOX','White-box'],[undefined,'Black-box']])('labels %s without relying on color',(mode,label)=>{const html=renderToStaticMarkup(createElement(AssessmentModeBadge,{mode}));expect(html).toContain(label);expect(html).toContain('ui-badge');expect(html).not.toContain('undefined');});
});
