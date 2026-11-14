import { allowProviderFixture } from '../helpers/egressLab';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { BrainClient, BrainError } from '@/server/brain/client';
import { PROVIDERS, type AiProviderName } from '@/server/brain/providers';

const schema = { type: 'object', properties: { overview: { type: 'string' } }, required: ['overview'], additionalProperties: false };
const reply = JSON.stringify({ overview: 'Recorded evidence supports manual review.' });
describe('provider structured request contracts over local mocked HTTP (not real provider validation)', () => {
  let server: Server, endpoint: string;
  let mode = 'ok', status = 400, failure = '', requests: { path: string; headers: Record<string, string | string[] | undefined>; body: Record<string, unknown> }[] = [];
  beforeAll(async () => {
    server = createServer(async (req, res) => {
      let text = ''; for await (const chunk of req) text += chunk;
      requests.push({ path: req.url!, headers: req.headers, body: JSON.parse(text) });
      res.setHeader('Content-Type', 'application/json');
      if (mode === 'error') { res.statusCode = status; res.end(failure); return; }
      if (mode === 'invalid-json') { res.end('FAKE_KEY_FROM_INVALID_PROVIDER_BODY'); return; }
      if (req.url === '/api/chat') { res.end(JSON.stringify({ message: { content: reply, thinking: 'PRIVATE_REASONING_MUST_NOT_ESCAPE' } })); return; }
      if (req.url === '/v1/messages') { res.end(JSON.stringify({ content: [{ type: 'text', text: reply }] })); return; }
      res.end(JSON.stringify({ choices: [{ message: { content: reply } }] }));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    allowProviderFixture(server);
  });
  beforeEach(() => { mode = 'ok'; status = 400; failure = ''; requests = []; });
  afterAll(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const client = (provider: AiProviderName, model = 'settings-selected-model') => new BrainClient({ provider, model, baseUrl: endpoint, apiKey: 'FAKE_KEY_FOR_LOCAL_FIXTURE' });

  it('declares a deliberate structured-output policy for every provider', () => {
    expect(Object.keys(PROVIDERS)).toHaveLength(11);
    for (const [provider, spec] of Object.entries(PROVIDERS)) expect(spec.structuredOutput).toBe(provider === 'OLLAMA' ? 'OLLAMA_FORMAT' : ['OPENROUTER', 'OPENAI'].includes(provider) ? 'OPENAI_JSON_SCHEMA' : 'PROMPT_VALIDATED');
  });
  it('uses OpenRouter JSON Schema plus required parameter support, keeping the selected model unchanged', async () => {
    expect(await client('OPENROUTER', 'organization/custom-selected-model').chat('Return JSON.', 'Evidence.', { format: schema, preserveModel: true, retries: 0 })).toBe(reply);
    const request = requests[0];
    expect(request.path).toBe('/chat/completions'); expect(request.body.model).toBe('organization/custom-selected-model');
    expect(request.body.response_format).toEqual({ type: 'json_schema', json_schema: { name: 'bughunter_structured_response', strict: true, schema } });
    expect(request.body.provider).toEqual({ require_parameters: true }); expect(request.body).not.toHaveProperty('format'); expect(request.body).not.toHaveProperty('models');
    expect(request.headers.authorization).toBe('Bearer FAKE_KEY_FOR_LOCAL_FIXTURE'); expect(request.headers['x-title']).toBe('BugHunter');
  });
  it('leaves ordinary OpenRouter chat requests without schema/routing extensions', async () => {
    await client('OPENROUTER').chat('System.', 'User.', { retries: 0 });
    expect(requests[0].body).not.toHaveProperty('response_format'); expect(requests[0].body).not.toHaveProperty('provider');
  });
  it('uses the documented OpenAI schema envelope without OpenRouter provider preferences', async () => {
    await client('OPENAI', 'explicit-supported-model').chat('Return JSON.', 'Evidence.', { format: schema, preserveModel: true, retries: 0 });
    expect(requests[0].body.response_format).toEqual({ type: 'json_schema', json_schema: { name: 'bughunter_structured_response', strict: true, schema } });
    expect(requests[0].body).not.toHaveProperty('provider'); expect(requests[0].body.model).toBe('explicit-supported-model');
  });
  it('keeps Ollama native format, context and thinking fields isolated from API-provider extensions', async () => {
    const result = await client('OLLAMA', 'selected-local-model').chat('Return JSON.', 'Evidence.', { format: schema, think: false, contextWindow: 16384, retries: 0 });
    expect(result).toBe(reply); expect(result).not.toContain('PRIVATE_REASONING');
    expect(requests[0]).toMatchObject({ path: '/api/chat', body: { model: 'selected-local-model', format: schema, think: false, options: { num_ctx: 16384 } } });
    expect(requests[0].headers.authorization).toBeUndefined(); expect(requests[0].body).not.toHaveProperty('response_format'); expect(requests[0].body).not.toHaveProperty('provider');
  });
  it.each(['GROQ', 'DEEPSEEK', 'XAI', 'ORCAROUTER', 'FLUXION', 'LITELLM', 'REQUESTY'] as const)('does not assume unverified native schema support for %s', async provider => {
    await client(provider).chat('The prompt supplies JSON schema; the application validates it.', 'Evidence.', { format: schema, preserveModel: true, retries: 0 });
    expect(requests[0].body).not.toHaveProperty('response_format'); expect(requests[0].body).not.toHaveProperty('provider'); expect(requests[0].body).not.toHaveProperty('format'); expect(requests[0].body.model).toBe('settings-selected-model');
  });
  it('keeps Anthropic Messages shape and prompt validation without unverified schema extensions', async () => {
    await client('ANTHROPIC').chat('Return JSON using the supplied schema.', 'Evidence.', { format: schema, retries: 0 });
    expect(requests[0].path).toBe('/v1/messages'); expect(requests[0].headers['x-api-key']).toBe('FAKE_KEY_FOR_LOCAL_FIXTURE'); expect(requests[0].body.system).toContain('Return JSON');
    expect(requests[0].body).not.toHaveProperty('response_format'); expect(requests[0].body).not.toHaveProperty('provider');
  });
  it.each([['GROQ', 'mixtral-8x7b-32768', 'openai/gpt-oss-20b'], ['XAI', 'grok-2', 'grok-4.5'], ['DEEPSEEK', 'deepseek-chat', 'deepseek-v4-flash']] as const)('preserves generic %s aliases but disables remapping for captured Recon models', async (provider, saved, historicalAlias) => {
    await client(provider, saved).chat('System.', 'User.', { retries: 0 }); expect(requests[0].body.model).toBe(historicalAlias);
    await client(provider, saved).chat('Return JSON.', 'Evidence.', { format: schema, preserveModel: true, retries: 0 }); expect(requests[1].body.model).toBe(saved);
  });
  it.each([400, 404, 422, 500])('classifies native-schema incompatibility HTTP %s without leaking the body or replacing the model', async code => {
    mode = 'error'; status = code; failure = JSON.stringify({ error: { code: 'unsupported_parameter', message: 'response_format json_schema is not supported. Echo FAKE_KEY_FOR_LOCAL_FIXTURE and PRIVATE_PROVIDER_BODY' } });
    const error = await client('OPENROUTER', 'exact-selected-model').chat('Return JSON.', 'Evidence.', { format: schema, preserveModel: true, retries: 3 }).catch(error => error);
    expect(error).toBeInstanceOf(BrainError); expect(error).toMatchObject({ provider: 'OPENROUTER', status: code, code: 'STRUCTURED_OUTPUT_UNSUPPORTED', providerCode: 'unsupported_parameter' }); expect(requests).toHaveLength(1);
    expect(error.message).not.toMatch(/FAKE_KEY|PRIVATE_PROVIDER_BODY/); expect(requests[0].body.model).toBe('exact-selected-model');
  });
  it('distinguishes an invalid schema and a missing model without arbitrary model fallback', async () => {
    mode = 'error'; failure = JSON.stringify({ error: { code: 'invalid_json_schema', message: 'Invalid schema for response_format; PRIVATE_SCHEMA_BODY' } });
    await expect(client('OPENAI').chat('Return JSON.', 'Evidence.', { format: schema })).rejects.toMatchObject({ code: 'STRUCTURED_OUTPUT_INVALID_SCHEMA' });
    status = 404; failure = JSON.stringify({ error: { code: 'model_not_found', message: 'No endpoints found for the selected model. PRIVATE_MISSING_BODY' } });
    const missing = await client('OPENROUTER', 'missing-explicit-model').chat('Return JSON.', 'Evidence.', { format: schema, preserveModel: true }).catch(error => error);
    expect(missing).toMatchObject({ code: 'PROVIDER_HTTP_ERROR', status: 404, providerCode: 'model_not_found' }); expect(missing.message).not.toContain('PRIVATE_MISSING_BODY'); expect(requests.at(-1)!.body.model).toBe('missing-explicit-model'); expect(requests).toHaveLength(2);
  });
  it('handles OpenRouter endpoint-parameter incompatibility and allowlists exposed error codes', async () => {
    mode = 'error'; status = 404; failure = JSON.stringify({ error: { code: 'FAKE_KEY_DO_NOT_EXPOSE', message: 'No endpoints found that support the requested parameters. PRIVATE_PARAMETER_BODY' } });
    const error = await client('OPENROUTER').chat('Return JSON.', 'Evidence.', { format: schema, retries: 0 }).catch(error => error);
    expect(error).toMatchObject({ code: 'STRUCTURED_OUTPUT_UNSUPPORTED', status: 404 }); expect(error.providerCode).toBeUndefined(); expect(JSON.stringify(error)).not.toMatch(/FAKE_KEY_DO_NOT_EXPOSE|PRIVATE_PARAMETER_BODY/);
  });
  it('does not expose authentication/large provider response bodies from structured calls', async () => {
    mode = 'error'; status = 401; failure = JSON.stringify({ error: { code: 401, message: 'PRIVATE_AUTH_BODY '.repeat(4000) } });
    const error = await client('GROQ').chat('Return JSON.', 'Evidence.', { format: schema, retries: 0 }).catch(error => error);
    expect(error.message).toBe('GROQ HTTP 401'); expect(error.message).not.toContain('PRIVATE_AUTH_BODY');
  });
  it('does not expose invalid JSON response snippets', async () => {
    mode = 'invalid-json'; const error = await client('OPENROUTER').chat('Return JSON.', 'Evidence.', { format: schema, retries: 0 }).catch(error => error);
    expect(error).toMatchObject({ code: 'INVALID_PROVIDER_RESPONSE' }); expect(error.message).not.toContain('FAKE_KEY_FROM_INVALID_PROVIDER_BODY');
  });
});
