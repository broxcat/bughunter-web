import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { load } from 'js-yaml';

// Static checks of the shipped deployment (Docker is not run by the test suite).
type Service = { environment?: Record<string, string>; env_file?: unknown; cap_add?: string[]; cap_drop?: string[]; security_opt?: string[]; command?: unknown };
const compose = load(readFileSync(new URL('../../docker-compose.yml', import.meta.url), 'utf8')) as { services: Record<string, Service> };
const dockerfile = readFileSync(new URL('../../Dockerfile', import.meta.url), 'utf8');
const app = ['web', 'worker', 'oob-catcher'];

describe('deployment secrets and privileges (H1/H2/B4)', () => {
  it('no service loads the whole .env file and app services drop every capability', () => {
    for (const [name, service] of Object.entries(compose.services)) expect(service.env_file, name).toBeUndefined();
    for (const name of app) {
      const service = compose.services[name];
      expect(service.cap_add, name).toBeUndefined();
      expect(service.cap_drop, name).toEqual(['ALL']);
      expect(service.security_opt, name).toContain('no-new-privileges:true');
    }
  });
  it('gives each service only the secrets it uses', () => {
    const env = (name: string) => Object.keys(compose.services[name].environment ?? {});
    expect(env('web')).toEqual(expect.arrayContaining(['AUTH_SECRET', 'AUTH_URL', 'DATABASE_URL', 'REDIS_URL', 'CREDENTIALS_ENCRYPTION_KEY']));
    expect(env('worker')).toEqual(expect.arrayContaining(['DATABASE_URL', 'REDIS_URL', 'CREDENTIALS_ENCRYPTION_KEY', 'BROWSER_SANDBOX']));
    for (const forbidden of ['AUTH_SECRET', 'AUTH_URL', 'GITHUB_SECRET', 'GOOGLE_CLIENT_SECRET', 'ALLOW_PUBLIC_REGISTRATION']) expect(env('worker')).not.toContain(forbidden);
    expect(env('oob-catcher').sort()).toEqual(['DATABASE_URL', 'LOG_LEVEL']);
    expect(compose.services.worker.environment!.BROWSER_SANDBOX).toBe('${BROWSER_SANDBOX:-enabled}');
  });
  it('requires Redis authentication and hands clients a password-bearing URL', () => {
    expect(JSON.stringify(compose.services.redis.command)).toContain('--requirepass');
    expect(compose.services.redis.environment!.REDIS_PASSWORD).toMatch(/\$\{REDIS_PASSWORD:\?/);
    for (const name of ['web', 'worker']) expect(compose.services[name].environment!.REDIS_URL).toBe('redis://:${REDIS_PASSWORD:?Set REDIS_PASSWORD (openssl rand -hex 32)}@redis:6379');
  });
  it('runs the image as an unprivileged user before the default command', () => {
    const runtime = dockerfile.slice(dockerfile.lastIndexOf('FROM node:22-bookworm AS runtime'));
    expect(runtime).toMatch(/useradd --uid 10001/);
    expect(runtime.indexOf('USER app')).toBeGreaterThan(0);
    expect(runtime.indexOf('USER app')).toBeLessThan(runtime.indexOf('CMD ['));
    expect(runtime).not.toMatch(/\/root\/nuclei-templates \/root/);
  });
});

import { assertWorkerEnv, redisAuthErrors } from '@/lib/env';
describe('Redis authentication at startup (B4)', () => {
  it('refuses an unauthenticated or malformed REDIS_URL in production only', () => {
    expect(redisAuthErrors({ NODE_ENV: 'production', REDIS_URL: 'redis://redis:6379' })[0]).toMatch(/password/);
    expect(redisAuthErrors({ NODE_ENV: 'production', REDIS_URL: 'redis://user@redis:6379' })[0]).toMatch(/password/);
    expect(redisAuthErrors({ NODE_ENV: 'production' })[0]).toMatch(/required/);
    expect(redisAuthErrors({ NODE_ENV: 'production', REDIS_URL: 'http://:p@redis' })[0]).toMatch(/redis:\/\//);
    expect(redisAuthErrors({ NODE_ENV: 'production', REDIS_URL: 'redis://:s3cret@redis:6379' })).toEqual([]);
    expect(redisAuthErrors({ NODE_ENV: 'development', REDIS_URL: 'redis://localhost:6379' })).toEqual([]);
    expect(() => assertWorkerEnv({ NODE_ENV: 'production', REDIS_URL: 'redis://redis:6379' })).toThrow(/Invalid worker environment/);
  });
});
