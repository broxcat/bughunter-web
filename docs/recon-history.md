# Recon history and diffs

Open a Scope Asset and expand **Changes since previous Recon**. Choose two retained Recon runs, newest versus older. A manual rerun is sufficient; scheduling is not required or enabled.

Each documentary surface has a Target/Scope Asset specific durable hash identity. Terminal runs record immutable membership, a narrow sanitized value fingerprint, original artifact/observation references and observation dates. First/last seen aggregate actual observation times; observed runs counts distinct memberships, including archived run references. Republishing a run is idempotent. Metadata survives deletion of its ScanRun; deleting its Target explicitly deletes its inventory.

Supported identities include hosts/DNS, ports/services, URLs/endpoints, API/auth surfaces, technologies, parameters, TLS, sanitized authentication context responses and graph relations. Authentication contexts remain separate; an unavailable response is not a denial. No raw HTTP bodies, headers, credential records or account labels enter the history projection. Static assets stay counted but their per-chunk paths are summarized in the UI.

The comparison classifies NEW, CHANGED, NOT_OBSERVED_THIS_RUN and UNCHANGED. One absence never means REMOVED. Compare run outcomes and stage coverage, especially partial/failed/cancelled runs. Historical `changeSet.removed` payloads remain readable and are displayed as “not observed”; stored snapshots are not rewritten.

A changed or unobserved matching covered URL can append a `NEEDS_RETEST` Coverage event, explicitly marked `RECON_DIFF` and “no test performed”. Earlier results and evidence stay intact. A later recorded researcher result is never overwritten by retrospective indexing. New surfaces are untested; no automatic Hypothesis or Finding is created. New session/context runs never inherit an old account's test result as coverage.

The worker publishes after execution completion and retries deferred indexing during maintenance. An owned history read also indexes missing retained runs. The UI exposes 50 recent comparisons, 100 dynamic rows per category and a truncation warning; structured history retains up to 10,000 artifacts and 5,000 graph edges per run, plus bounded authenticated observations. Original artifacts/coverage remain available. Dates describe recorded evidence, not continuous availability.

History is documentary. It never adds a Scope Asset, authorizes a discovered host, issues network requests or reconstructs sanitized private URLs.
