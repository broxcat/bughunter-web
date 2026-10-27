// Synthetic metadata only. Never contacts the named .test host.
export function loopHypothesis({ targetId = 'target', host = 'app.example.test', status = 'OPEN', ref = 'evidence/positive.txt' } = {}) {
  const observation = (id, summary, source = 'HTTP', artifact = ref) => ({ id, source, host, location: `https://${host}/objects/fixture`, observedAt: '2026-10-27T20:00:00Z', summary, evidence: [{ ref: artifact, summary: 'Locally captured synthetic observation, no external target traffic.' }] });
  const test = { id: 'T-001', rationale: 'Compare the same controlled object under distinct authorized fixture principals.', procedure: 'Replay the known fixture object request as authorized account B.', expectedSignal: 'Account B obtains the controlled object belonging to A.', falsificationCondition: 'Account B receives an independent denial or its own object.', performedAt: '2026-10-27T20:01:00Z',
    observations: [observation('O-002', 'Authorized fixture account B received the controlled marker owned by fixture account A.')],
    negativeControl: { kind: 'PERFORMED', procedure: 'Repeat the object lookup without authentication in the local fixture.', observations: [observation('O-003', 'Anonymous fixture request was denied independently of object identity.', 'HTTP', 'evidence/control.txt')], significance: 'The anonymous control is denied while the second authorized principal receives the cross-account controlled marker.' },
    outcome: status === 'REJECTED' ? 'REFUTES' : 'SUPPORTS', reproduced: true,
    reproductionSteps: ['Create the controlled fixture object as account A.', 'Repeat its read-only object lookup with account B and the anonymous control.'],
    reproducibility: 'The local synthetic comparison was repeated twice with the same controlled markers and independent authentication contexts.',
    securityEffect: 'The synthetic positive case crosses the intended object ownership boundary while the independent anonymous control denies access.',
    evidenceQuality: 'CONTROLLED', conclusion: status === 'REJECTED' ? 'The new controlled fixture observations falsify the proposed cross-account behavior.' : 'The controlled fixture shows reproducible cross-account object disclosure for human review.' };
  return { externalId: 'H-001', title: 'Observed fixture object boundary', status,
    hypothesis: 'The observed read-only object response may cross the fixture account ownership boundary.',
    evidenceFor: [{ ref, summary: 'Captured the initial object observation in a controlled local fixture.' }],
    evidenceAgainst: status === 'REJECTED' ? [{ ref: 'evidence/control.txt', summary: 'Independent fixture controls falsified the proposed mechanism.' }] : [],
    nextTest: 'Compare another independently created controlled fixture object with the two authorized test accounts.',
    expectedSignal: 'The controlled object crosses the fixture ownership boundary.', falsificationCondition: 'Independent account authorization denies access or returns only the requesting account object.', confidence: 'MEDIUM', tags: ['object-access'],
    targetId, host, location: `https://${host}/objects/fixture`, suspectedVulnClass: 'IDOR', createdAt: '2026-10-27T20:00:00Z',
    initialObservations: [observation('O-001', 'An authenticated fixture endpoint exposes an observed opaque object reference.')], reasoning: 'The observed object identifier and authenticated contexts provide a concrete ownership boundary to test.',
    prerequisites: ['Two authorized synthetic test accounts with a controlled fixture object.'], suspectedImpact: 'Possible disclosure of a controlled cross-account object; severity requires independent human assessment.',
    tests: ['CONFIRMED', 'REJECTED', 'TESTING'].includes(status) ? [test] : [],
    nextTestRationale: 'This uses an independently owned object and checks object-specific rather than encoding-specific behavior.',
    conclusion: ['CONFIRMED', 'REJECTED'].includes(status) ? test.conclusion : null, suggestedSeverity: 'HIGH',
    ...(status === 'BLOCKED' ? { blockedReason: 'The second authorized fixture account is temporarily unavailable.' } : {}),
  };
}
export function loopDocument(sessionId, options) { return { version: 2, sessionId, hypotheses: [loopHypothesis(options)] }; }
