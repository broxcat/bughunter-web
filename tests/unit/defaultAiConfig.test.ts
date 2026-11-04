import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({first:vi.fn(),unique:vi.fn(),decrypt:vi.fn()}));
vi.mock('@/lib/prisma',()=>({prisma:{aiProviderConfig:{findFirst:mocks.first,findUnique:mocks.unique}}}));
vi.mock('@/lib/crypto',()=>({decryptSecret:mocks.decrypt}));
import { resolveConfiguredProviderFields, resolveDefaultAiConfig, resolveProviderApiKey, AiConfigurationError } from '@/server/brain/config';
const ollama={id:'config-ollama',provider:'OLLAMA',model:'selected-model',baseUrl:'http://selected-ollama.test:11434',apiKeyCipher:null};
beforeEach(()=>{vi.clearAllMocks();mocks.first.mockResolvedValue(null);mocks.unique.mockResolvedValue(null);mocks.decrypt.mockReturnValue('private-provider-key');});
afterAll(()=>vi.restoreAllMocks());
describe('persisted default AI configuration',()=>{
  it('does not choose Ollama, another saved provider or an environment model when no default exists',async()=>{expect(await resolveDefaultAiConfig('owner')).toBeNull();expect(mocks.first).toHaveBeenCalledWith(expect.objectContaining({where:{userId:'owner',isActive:true}}));});
  it('uses the configured Ollama endpoint and exact model without a key',async()=>{mocks.first.mockResolvedValue(ollama);expect(await resolveDefaultAiConfig('owner')).toMatchObject({configId:ollama.id,provider:'OLLAMA',model:'selected-model',effectiveBaseUrl:ollama.baseUrl});expect(mocks.decrypt).not.toHaveBeenCalled();});
  it('can capture provider metadata without decrypting its key',async()=>{mocks.first.mockResolvedValue({...ollama,provider:'OPENROUTER',baseUrl:null,apiKeyCipher:'cipher'});const value=await resolveDefaultAiConfig('owner',{includeApiKey:false});expect(value).toMatchObject({provider:'OPENROUTER',effectiveBaseUrl:'https://openrouter.ai/api/v1'});expect(value).not.toHaveProperty('apiKey');expect(mocks.decrypt).not.toHaveBeenCalled();});
  it('reads credentials for the captured provider independently of today’s default, model and endpoint',async()=>{mocks.unique.mockResolvedValue({apiKeyCipher:'captured-provider-cipher'});expect(await resolveProviderApiKey('owner','OPENROUTER')).toBe('private-provider-key');expect(mocks.unique).toHaveBeenCalledWith({where:{userId_provider:{userId:'owner',provider:'OPENROUTER'}},select:{apiKeyCipher:true}});expect(mocks.first).not.toHaveBeenCalled();});
  it('reports absent or undecryptable keys without exposing ciphertext or secret diagnostics',async()=>{await expect(resolveProviderApiKey('owner','OPENROUTER')).rejects.toMatchObject({code:'FAILED_PROVIDER_CONFIGURATION'});mocks.unique.mockResolvedValue({apiKeyCipher:'PRIVATE_CIPHER'});mocks.decrypt.mockImplementation(()=>{throw new Error('PRIVATE_DECRYPTION_DETAIL');});try{await resolveProviderApiKey('owner','OPENROUTER');}catch(error){expect(error).toBeInstanceOf(AiConfigurationError);expect(String(error)).not.toMatch(/PRIVATE_CIPHER|PRIVATE_DECRYPTION_DETAIL/);}});
  it.each([
    {provider:'OLLAMA',model:'chosen',baseUrl:null,hasApiKey:false},
    {provider:'OLLAMA',model:'',baseUrl:'http://configured.test',hasApiKey:false},
    {provider:'OPENROUTER',model:'chosen',baseUrl:null,hasApiKey:false},
    {provider:'LITELLM',model:'chosen',baseUrl:null,hasApiKey:true},
    {provider:'OPENROUTER',model:'chosen',baseUrl:'https://key:secret@provider.test',hasApiKey:true},
    {provider:'OPENROUTER',model:'chosen',baseUrl:'https://provider.test?api_key=secret',hasApiKey:true},
  ])('rejects incomplete or credential-bearing configuration $provider',input=>expect(()=>resolveConfiguredProviderFields(input)).toThrow(AiConfigurationError));
});
