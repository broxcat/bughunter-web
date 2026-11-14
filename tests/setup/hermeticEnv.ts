// Prisma loads the developer's .env on import without overriding variables
// that are already defined. AUTH_URL decides the admitted browser Origin (B1);
// pin it to "unset" so tests behave the same on every machine. Tests that need
// a public origin stub it explicitly.
process.env.AUTH_URL = '';
