import { createResearchBundle, writeResearchWorkspace } from "../../src/server/research/workspace";
import { researchTarget, researchRecon, researchSession } from "../fixtures/research";
const result = await writeResearchWorkspace(process.argv[2], researchSession.workspaceId, createResearchBundle(researchTarget(), researchRecon(), [], researchSession));
process.stdout.write(JSON.stringify({ ...result, workspaceId: researchSession.workspaceId }));
