
import { z } from 'zod';

export const TOKEN_PLATFORMS = ['HACKERONE', 'BUGCROWD', 'INTIGRITI'] as const;
export const IMPORT_PLATFORMS = [...TOKEN_PLATFORMS, 'YESWEHACK'] as const;
export type ImportPlatform = typeof IMPORT_PLATFORMS[number];
export const tokenPlatformSchema = z.enum(TOKEN_PLATFORMS);

const token = z.string().trim().min(1).max(2048).regex(/^[\x21-\x7e]+$/);
const username = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
export const platformConnectionSchema = z.discriminatedUnion('platform', [
  z.strictObject({ platform: z.literal('HACKERONE'), username, token: token.refine(value => !value.includes(':')) }),
  z.strictObject({ platform: z.literal('BUGCROWD'), username, token: token.refine(value => !value.includes(':')) }),
  z.strictObject({ platform: z.literal('INTIGRITI'), token }),
]);
export type PlatformConnectionInput = z.infer<typeof platformConnectionSchema>;
