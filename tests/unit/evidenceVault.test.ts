import {describe,it,expect} from 'vitest';
import {evidenceCreateSchema,redactEvidenceText} from '@/lib/evidenceVault';
import {renderReport} from '@/lib/reportTemplates';
describe('minimal Evidence Vault metadata contract',()=>{
 it('accepts narrow explicit HTTP metadata and rejects raw headers or unknown credentials',()=>{
  const v={kind:'HTTP_REQUEST_RESPONSE',sessionId:'session',description:'Controlled HTTP capture',observedAt:'2026-11-06T12:00:00Z',http:{method:'GET',url:'https://app.example.test/api',statusCode:403}};
  expect(evidenceCreateSchema.safeParse(v).success).toBe(true);expect(evidenceCreateSchema.safeParse({...v,http:{...v.http,headers:{Authorization:'PRIVATE'}}}).success).toBe(false);expect(evidenceCreateSchema.safeParse({...v,apiKey:'PRIVATE'}).success).toBe(false);
 });
 it('redacts nested camelCase tokens, credentials, personal email and PEM blocks',()=>{
  const v=redactEvidenceText(JSON.stringify({accessToken:'PRIVATE_ACCESS',nested:{refresh_token:'PRIVATE_REFRESH',sessionCookie:'PRIVATE_COOKIE',authorizationHeader:'PRIVATE_AUTH',email:'person@example.test'},ok:'Visible observation'}));
  expect(v).not.toContain('PRIVATE_');expect(v).not.toContain('person@');expect(v).toContain('Visible observation');expect(redactEvidenceText('sessionToken: PRIVATE_TOKEN')).not.toContain('PRIVATE_TOKEN');expect(redactEvidenceText('-----BEGIN PRIVATE KEY-----\nPRIVATE_KEY\n-----END PRIVATE KEY-----')).not.toContain('PRIVATE_KEY');
 });
 it('rejects traversing, encoded and remote workspace references',()=>{for(const ref of ['../../secret','https://foreign.test/file','requests/%2e%2e/x','requests/x\\y'])expect(evidenceCreateSchema.safeParse({kind:'RESEARCH_EVIDENCE',sessionId:'session',description:'Reference',ref}).success).toBe(false);});
 it('keeps common Evidence IDs and hashes in reports without Markdown injection',()=>{const text=renderReport('GENERIC',{title:'Fixture',findings:[{title:'Finding',severity:'LOW',vaultEvidence:[{id:'EV-fixture',kind:'RECON_ARTIFACT',description:'[unsafe](javascript:run)',contentSha256:'a'.repeat(64)}]}]});expect(text).toContain('EV-fixture');expect(text).toContain('a'.repeat(64));expect(text).not.toContain('[unsafe](javascript:run)');});
});
