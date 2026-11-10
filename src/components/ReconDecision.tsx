import type { ReconReportModel } from "@/lib/reconReportModel";
export default function ReconDecision({
  model: m,
}: {
  model: ReconReportModel;
}) {
  const groups: [string, string[]][] = [
    ["Responsive web hosts", m.web.responsiveHosts],
    [
      "Technologies",
      m.web.technologies.map((t) =>
        [t.name, t.version].filter(Boolean).join(" "),
      ),
    ],
    ["Auth surfaces", m.web.authSurfaces],
    ["API surfaces", m.web.apiSurfaces],
    [
      "Interesting endpoints",
      m.web.endpoints.map(
        (e) => `${e.method ?? ""} ${e.url}${e.status ? " · " + e.status : ""}`,
      ),
    ],
    [
      "Coverage gaps / important errors",
      m.limitations.map(
        (l) => `${l.host} · ${l.stage}: ${l.reason ?? l.label}`,
      ),
    ],
    ["Research handoff", m.researchHandoff],
  ];
  return (
    <div className="space-y-5">
      <section>
        <h2>Recon result</h2>
        <p>{m.metadata.outcomeLabel}</p>
        {m.metadata.outcomeDetail && <p>{m.metadata.outcomeDetail}</p>}
      </section>
      {groups.map(([title, items]) => (
        <section key={title}>
          <h2 className="font-semibold">{title}</h2>
          {items.length ? (
            <ul className="space-y-1 break-all text-sm">
              {items.map((v, i) => (
                <li key={i}>{v}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">None recorded.</p>
          )}
        </section>
      ))}
      <section>
        <h2>Changes since previous Recon</h2>
        <p>
          {m.changes
            ? `${m.changes.new} new · ${m.changes.changed} changed · ${m.changes.notObserved} not observed. ${m.changes.note}`
            : "No comparable previous run."}
        </p>
      </section>
    </div>
  );
}
