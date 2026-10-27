import { z } from 'zod';

// Shared program/Research policy; never turn credential availability into auth.
export const requiredUserAgentSchema = z.string().trim()
  .min(1, 'User-Agent is required').max(512)
  .regex(/^[\x20-\x7e]+$/, 'User-Agent must contain printable ASCII only');
