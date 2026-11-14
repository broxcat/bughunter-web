// Prisma loads the developer's .env on import without overriding variables
// that are already defined. AUTH_URL decides the admitted browser Origin (B1);
// pin it to "unset" so tests behave the same on every machine. Tests that need
// a public origin stub it explicitly.
process.env.AUTH_URL = '';
// Never let Prisma's automatic .env loading select the operator's services.
// Integration suites explicitly replace these with their disposable TEST URLs.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://test:test@127.0.0.1:1/disabled';
process.env.REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://:test@127.0.0.1:1';
process.env.OLLAMA_HOST = '';
process.env.RESEARCH_EMBEDDING_URL = '';
process.env.EGRESS_LAB_ALLOWLIST = '';
