// Installed initialization hook, never target-supplied JavaScript/configuration.
exports.default = async ({ page }) => {
  const p = JSON.parse(process.env.BUGHUNTER_BROWSER_POLICY);
  const { acquireResearchTraffic, mergeResearchHeaders } = await import('./program-traffic.mjs');
  const { assetAllowsUrl } = await import('../../../src/lib/scopeAssets.ts');
  const allowed = value => { try { const u = new URL(value); return u.protocol === `${p.scheme}:` && u.hostname === p.host && Number(u.port || (p.scheme === 'https' ? 443 : 80)) === p.port && !u.username && !u.password && (!p.assetScope || assetAllowsUrl(p.assetScope, value)); } catch { return false; } };
  const context = page.context();
  if (context.__bughunterScoped) return; context.__bughunterScoped = true;
  await context.route('**/*', async route => {
    if (!allowed(route.request().url())) return route.abort('blockedbyclient');
    let permit;
    try {
      permit = await acquireResearchTraffic(p, 'research-browser', route.request().url());
      const headers = mergeResearchHeaders(route.request().headers(), permit.headers);
      const response = await route.fetch({ maxRedirects: 0, timeout: 15000, headers });
      try {
        const responseHeaders = { ...response.headers() };
        if (response.status() >= 300 && response.status() < 400 && responseHeaders.location) {
          responseHeaders['x-bughunter-redirect-location'] = responseHeaders.location;
          delete responseHeaders.location;
        }
        await route.fulfill({ response, headers: responseHeaders });
      } finally { await response.dispose(); }
    } catch { await route.abort('failed').catch(() => {}); }
    finally { await permit?.release(); }
  });
  await context.routeWebSocket('**/*', ws => ws.close()); // No unguarded websocket channel.
};
