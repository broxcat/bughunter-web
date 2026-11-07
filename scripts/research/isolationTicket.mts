// Operator-only issuer, run in the trusted web environment. Never in Research.
// Token goes directly to stdout for piping to the offline migration command.
import {prisma} from '../../src/lib/prisma';
import {isolationMigrationTicket} from '../../src/server/research/terminalTicket';
const targetId=process.argv[2];
try {
 if(!targetId||process.argv.length!==3)throw new Error('Target required');
 const target=await prisma.target.findUniqueOrThrow({where:{id:targetId},select:{userId:true}});
 const result=await isolationMigrationTicket(target.userId,targetId);
 process.stdout.write(result.token);
} catch {process.stderr.write('Migration authorization unavailable; operator review required.\n');process.exitCode=1;}
finally {await prisma.$disconnect();}
