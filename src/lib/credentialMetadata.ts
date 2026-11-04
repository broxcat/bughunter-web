import { z } from "zod";
export const CREDENTIAL_PURPOSES = ["ACCOUNT_A", "ACCOUNT_B", "SESSION_COOKIE", "JWT", "OTHER"] as const;
export const credentialPersonaSchema=z.string().refine(value=>!/[\x00-\x1f\x7f]/.test(value),'Persona must not contain control characters').transform(value=>value.trim()).pipe(z.string().max(80)).transform(value=>value||null).nullable();
const metadataFields={purpose:z.enum(CREDENTIAL_PURPOSES),ownedObjectUrl:z.string().url().nullable(),persona:credentialPersonaSchema,reconEnabled:z.boolean()};
export const credentialMetadataSchema=z.object({purpose:metadataFields.purpose.default('OTHER'),ownedObjectUrl:metadataFields.ownedObjectUrl.optional(),persona:metadataFields.persona.optional(),reconEnabled:metadataFields.reconEnabled.default(false)});
// PATCH must not apply CREATE defaults to unrelated metadata.
export const credentialMetadataPatchSchema=z.object({purpose:metadataFields.purpose.optional(),ownedObjectUrl:metadataFields.ownedObjectUrl.optional(),persona:metadataFields.persona.optional(),reconEnabled:metadataFields.reconEnabled.optional()});
export function ownedReferenceUrl(value: string | null | undefined, host: string): string | null {
  if (!value) return null;
  if (/[\x00-\x20\x7f\\]/.test(value)) throw new Error('Use an unambiguous same-host object URL');
  const u = new URL(value);
  if (!/^https?:$/.test(u.protocol) || u.host !== host || u.username || u.password || /(?:token|secret|password|session|authorization|cookie|code|key)/i.test([...u.searchParams.keys()].join(" "))) throw new Error("Use a same-host object URL without secrets or URL credentials");
  u.hash = ""; return u.toString();
}
