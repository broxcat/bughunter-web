import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ReconSummaryProviderDetails, ReconSummaryRoutingNotice } from '@/components/ReconSummaryButton';

describe('Recon summary provider provenance and default routing', () => {
  it.each([['OPENROUTER','OpenRouter'],['OLLAMA','Ollama']])('shows the captured %s provider, model and prompt', (provider,label) => {
    const html=renderToStaticMarkup(createElement(ReconSummaryProviderDetails,{summary:{provider,model:'chosen-model',promptVersion:'recon-report/3'}}));
    expect(html).toContain('Provider: '+label);expect(html).toContain('Model: chosen-model');expect(html).toContain('Prompt: recon-report/3');
  });
  it('explains a new default without invalidating stored evidence or regenerating',()=>{
    const html=renderToStaticMarkup(createElement(ReconSummaryRoutingNotice,{changed:true,current:{provider:'OPENROUTER',model:'chosen-model'}}));
    expect(html).toContain('default AI provider is now OpenRouter');expect(html).toContain('stored report remains unchanged');expect(html).toContain('Regenerate');
  });
  it.each(['NO_DEFAULT_PROVIDER','INVALID_DEFAULT_PROVIDER'] as const)('keeps factual reports usable when %s',issue=>{
    const html=renderToStaticMarkup(createElement(ReconSummaryRoutingNotice,{issue,changed:false,current:null}));
    expect(html).toContain('/settings');expect(html).toContain('Recon facts and scope.md remain available');expect(html).not.toContain(issue);
  });
  it('escapes provider metadata instead of interpreting it as HTML',()=>{
    const html=renderToStaticMarkup(createElement(ReconSummaryProviderDetails,{summary:{provider:'OPENROUTER',model:'<script>remote</script>',promptVersion:'recon-report/3'}}));
    expect(html).not.toContain('<script>');expect(html).toContain('&lt;script&gt;');
  });
});
