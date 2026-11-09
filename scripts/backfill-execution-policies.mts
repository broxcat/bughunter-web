
import { backfillExecutionPolicies } from '../src/server/backfillExecutionPolicies';
import { prisma } from '../src/lib/prisma';

const args = process.argv.slice(2);
if (args.length !== 1 || !['--dry-run', '--apply'].includes(args[0])) {
  console.error('Usage: npm run policy:backfill -- --dry-run | --apply');
  process.exitCode = 2;
} else {
  try {
    console.log(JSON.stringify(await backfillExecutionPolicies(args[0] === '--dry-run'), null, 2));
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}
