import { z } from 'zod';

// Database IDs only. Neither hostnames nor client paths name a Target or session.
export const targetIdentity = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/);
