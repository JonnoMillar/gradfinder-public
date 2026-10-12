/**
 * `/sweeps` — the run log. Errors are shown in full, never truncated: a source that breaks has to
 * be diagnosable from this page alone (spec §4, §7).
 */
import { fmtDateTime } from "@/lib/ui/format";
import { PageSlide } from "@/components/PageSlide";
import { failingSources, recentSweeps } from "@/lib/queries";
import { FailedSourceBanner } from "@/components/FailedSourceBanner";

export const dynamic = "force-dynamic";

const secs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`);

export default async function SweepsPage() {
  const rows = recentSweeps(60);
  const failing = failingSources();

  return (
    <PageSlide>
    <>
      <FailedSourceBanner failing={failing} />
      <main className="wrap ff">
        <div className="lead" style={{ padding: "8px 0 0" }}>
          <h1>Sweep runs</h1>
          <p className="sub">
            Newest first. A source that returns zero results counts as a failure, so an empty run is
            never silently treated as success.
          </p>
        </div>

        {rows.length === 0 ? (
          <p className="empty">
            <b>No sweeps recorded.</b>
            Run <code>npm run sweep -- --source higherin,targetjobs</code> to populate this.
          </p>
        ) : (
          <table className="sweeps">
            <thead>
              <tr>
                <th>Run</th><th>Source</th><th>Status</th>
                <th>Found</th><th>New</th><th>Updated</th><th>Took</th><th>Started</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.runId}</td>
                  <td><b>{r.source}</b></td>
                  <td>
                    <span className={`status-${r.status}`}>{r.status}</span>
                    {r.error ? <div className="errbox">{r.error}</div> : null}
                  </td>
                  <td>{r.discovered}</td>
                  <td>{r.inserted}</td>
                  <td>{r.updated}</td>
                  <td>{secs(r.durationMs)}</td>
                  <td style={{ whiteSpace: "nowrap", color: "var(--ink-3)" }}>
                    {fmtDateTime(r.startedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="prov">
          <b>How to read this.</b> Each row is one source inside one run. The orchestrator catches a
          failing adapter, records it here, and carries on with the other sources, so a partial run
          still produces results — but the banner stays up until that source succeeds again.
        </div>
      </main>
    </>
    </PageSlide>
  );
}
