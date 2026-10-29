/**
 * A role, as a tile. (The This week band is a timeline instead: WeekRunway.)
 *
 * Hierarchy (Jonno + design review, 2026-09-29): when it closes → who (the company, bold: it is short, so the eye lands
 * on something quick to read) with the role under it → fit, as a score out of 100 in a medal-coloured ring (FitRing)
 * → one quiet line of detail. The ring's tier also tints the tile's edge, so the grid is no longer a wall of identical
 * cards and the few platinum roles stand out.
 *
 * The bin in the corner (NotInterested) drops the role from the list for good, with Undo.
 *
 * `data-slide` marks the parts that change between roles at one company: a company deck (CompanyStack) slides only
 * those, and the card, logo and company name stay put.
 */
import Link from "next/link";
import { Logo, NewStamp, SportStamp } from "./primitives";
import { FitRing } from "./FitRing";
import { NotInterested } from "./NotInterested";
import { IconPin } from "@/lib/ui/icons";
import { APPLICATION_STATUS_LABEL, daysUntil, deadlineTier, shortPay } from "@/lib/ui/format";
import { fitTier } from "@/lib/ui/fit";
import type { JobListRow } from "@/lib/queries";

function Due({ deadline }: { deadline: string | null }) {
  const d = daysUntil(deadline);
  const tier = deadlineTier(deadline);
  // no deadline: nothing at all (Jonno 2026-09-29: "no number means no deadline")
  if (d === null) return <span className="due" />;
  if (d < 0) return <span className={`due g-${tier}`}>Closed {Math.abs(d)}d ago</span>;
  if (d === 0) return <span className={`due g-${tier}`}><b>Closes today</b></span>;
  return <span className={`due g-${tier}`}><b>{d}</b> day{d === 1 ? "" : "s"} left</span>;
}

const dueFlag = (deadline: string | null) => {
  const t = deadlineTier(deadline);
  return t === "hot" || t === "warm" ? t : undefined;
};

export function JobRow({ job, fresh }: { job: JobListRow; fresh?: boolean }) {
  const pay = shortPay(job.salaryText);
  const tracked = job.status && job.status !== "discovered";

  return (
    <div className="tile-w">
      <Link
        href={`/jobs/${job.id}`}
        transitionTypes={["nav-forward"]}
        className={`tile${job.excludedReason ? " tile--excluded" : ""}`}
        data-due={dueFlag(job.deadline)}
        data-tier={fitTier(job.rankScore)}
        data-sport={job.sport ? "1" : undefined}
        aria-label={`${job.company}: ${job.title}`}
      >
        <span className="tile-top" data-slide>
          <Due deadline={job.deadline} />
          {tracked ? (
            <span className="pill-status" data-s={job.status}>{APPLICATION_STATUS_LABEL[job.status!] ?? job.status}</span>
          ) : null}
        </span>

        <span className="tile-main">
          <span className="tile-logo"><Logo company={{ name: job.company, logoUrl: job.logoUrl, domain: job.domain }} size={32} /></span>
          <span className="tile-name">
            <b className="tile-co">{job.company}</b>
            <span className="tile-role" data-slide>{job.title}</span>
          </span>
          <span data-slide><FitRing score={job.rankScore} rankPos={job.rankPos} /></span>
        </span>

        <span className="tile-meta" data-slide>
          {fresh ? <NewStamp /> : null}
          {job.sport ? <SportStamp /> : null}
          {job.excludedReason ? (
            <span className="pill-excl" title={`Filtered out: ${job.excludedReason}`}>
              {job.excludedReason.split(":")[0].replace(/_/g, " ")}
            </span>
          ) : null}
          {!job.inLondon ? (
            <span className="pill-loc" title={`Not in London as far as the posting says: ${job.locationRaw ?? "no location given"}`}>
              <IconPin width={12} height={12} />{job.locationRaw ? "Not London" : "Where?"}
            </span>
          ) : null}
          {pay ? <span className="pay">{pay}</span> : null}
        </span>
      </Link>
      {/* a sibling of the link, not inside it: a button in an <a> is invalid and would open the role */}
      {job.status === "dismissed" ? null : <NotInterested jobId={job.id} company={job.company} status={job.status} />}
    </div>
  );
}
