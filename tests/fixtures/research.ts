import type { ResearchTarget } from "@/server/research/workspace";
import { analyzeCorpus, persistableCorpus } from "@/server/recon/corpus";
export const researchTarget = (): ResearchTarget => ({
  id: "target", userId: "owner", host: "app.example.test", scheme: "https", active: true,
  scope: { id: "scope", userId: "owner", hostPattern: "app.example.test", status: "APPROVED", rulesOfEngagement: "No destructive operations.", scopeDetails: null, outOfScope: null, disclosurePolicy: "Private disclosure only.", safeHarbor: null, legalTerms: null, eligibilityCriteria: null, reportingFormat: null },
  program: { id: "program", ownerId: "owner", companyName: "Synthetic Research", requiredUserAgent: "Research-Test/1", outOfScope: ["admin.example.test"], qualifying: [], nonQualifying: ["BUSINESS_LOGIC"] },
  credentials: [{ label: "Account A", purpose: "ACCOUNT_A", sessionStatus: "VALID" }],
});
export const researchRecon = () => ({ id: "recon", reconCorpus: persistableCorpus(analyzeCorpus({ urls: ["https://app.example.test/search?q=private-value", "https://app.example.test/app.js", "https://foreign.example.test/"], html: '<form action="/profile" method="POST"><input name="email"><input type="hidden" name="csrf" value="csrf-fixture-secret"></form>', pages: [{ url: "https://app.example.test/", body: "raw-private-body", status: 200, headers: { server: "nginx", "set-cookie": "sid=cookie-fixture-secret" } }], authenticated: false }, "https://app.example.test")) });
export const researchSession = { id: "session", workspaceId: "62fbe758-f195-45fb-87a4-d5ab78b66baa", createdAt: new Date("2026-10-27T00:00:00Z") };
