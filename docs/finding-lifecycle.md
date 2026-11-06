# Finding lifecycle and Retest

The business lifecycle is independent of Evidence Review. Human Research promotion and manual creation still produce CANDIDATE. A confirmed Hypothesis never creates or validates a Finding automatically.

Expand **Lifecycle & Retest** on a Finding. Record a reason for each revision. The API enforces an explicit transition graph, a revision check and idempotent decision identity. Historical Findings retain a null lifecycle (“Historical / not captured”); their old review, Reports and proof remain readable. No past lifecycle decisions are invented by migration.

New Findings follow CANDIDATE → VALIDATING → VALIDATED → READY_TO_SUBMIT → SUBMITTED, then manual triage outcomes (TRIAGED, ACCEPTED, DUPLICATE, INFORMATIVE, NOT_APPLICABLE), resolution and closure. Rejected decisions stay in history and can be reopened for validation. VALIDATED requires confirmed Evidence Review, supporting Vault proof, an authorized location and explicit checks: reproduction, demonstrated impact, Scope, negative control or explained non-applicability, and a conclusion. It never means the surrounding surface is safe.

Submission fields are manual: platform, external report ID/HTTPS URL, submission time, triage severity, bounty amount/currency and external status. They send no external submission or network request. Each saved change is retained with its decision. Secret query values in report URLs are removed.

After an announced fix, RESOLVED → RETEST_REQUIRED creates a new activity with the original Evidence IDs. Linked Coverage becomes NEEDS_RETEST without claiming another test was performed. Record a new dated test, Research session, researcher, conclusion and new Vault evidence. Completed results are immutable: FIX_CONFIRMED, STILL_REPRODUCIBLE, PARTIALLY_FIXED or CANNOT_RETEST. Only a confirmed fix permits closure from retest; other outcomes remain open for a human decision. CANNOT_RETEST may record a blocker without a session or new proof. Another retest requires another activity; the original proof is never replaced.

Reports keep their Evidence Review gate. A new Finding also needs a recorded VALIDATED lifecycle decision and an eligible current state; rejected, duplicate, informative, not-applicable, unvalidated Candidates are excluded. Historical null lifecycle Findings retain their original confirmed-review export compatibility. Report creation locks eligibility rows for the transaction, preventing concurrent review changes from exporting a newly ineligible Finding. Reports include lifecycle, resolution/closure caveats, retest outcomes and original/new durable Evidence IDs. Saved Reports remain historical snapshots.

The Target Report page supports Program-wide Findings and history; technical Target reports remain compatible. Evidence provenance is resolved against each actual technical Target, never by treating the Program ID as a technical ID.
