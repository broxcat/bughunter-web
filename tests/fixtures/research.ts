import { analyzeCorpus, persistableCorpus } from '@/server/recon/corpus';

export const researchRecon = () => ({
  id: 'recon',
  reconCorpus: persistableCorpus(analyzeCorpus({
    urls: [
      'https://app.example.test/search?q=private-value',
      'https://app.example.test/app.js',
      'https://foreign.example.test/',
    ],
    html: '<form action="/profile" method="POST"><input name="email"><input type="hidden" name="csrf" value="csrf-fixture-secret"></form>',
    pages: [{
      url: 'https://app.example.test/',
      body: 'raw-private-body',
      status: 200,
      headers: { server: 'nginx', 'set-cookie': 'sid=cookie-fixture-secret' },
    }],
    authenticated: false,
  }, 'https://app.example.test')),
});
