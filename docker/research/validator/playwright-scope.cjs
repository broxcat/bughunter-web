// Installed initialization hook, never target-supplied JavaScript/configuration.
exports.default = async ({ page }) => {
  const p = JSON.parse(process.env.BUGHUNTER_BROWSER_POLICY);
  const allowed = value => { try { const u = new URL(value); return u.protocol === `${p.scheme}:` && u.hostname === p.host && Number(u.port || (p.scheme === 'https' ? 443 : 80)) === p.port && !u.username && !u.password; } catch { return false; } };
  const context = page.context();
  if (context.__bughunterScoped) return; context.__bughunterScoped = true;
  await context.route('**/*', async route => {
    if (!allowed(route.request().url())) return route.abort('blockedbyclient');
    try {
      // A response redirect is checked BEFORE returning it to the browser.
      // The API client never follows it on its own; cross-host redirects abort.
      const response = await route.fetch({ maxRedirects: 0, timeout: 15000, headers: { ...route.request().headers(), 'user-agent': p.requiredUserAgent } });
      const location = response.headers().location;
      if (response.status() >= 300 && response.status() < 400 && location && !allowed(new URL(location, route.request().url()).href)) { await response.dispose(); return route.abort('blockedbyclient'); }
      await route.fulfill({ response }); await response.dispose();
    } catch { await route.abort('failed').catch(() => {}); }
  });
  await context.routeWebSocket('**/*', ws => ws.close()); // No unguarded websocket channel.
};
