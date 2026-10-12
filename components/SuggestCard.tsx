/**
 * Up next: the one role to start applying for now, from `suggestNext()` (rank score plus a deadline bonus).
 * Since 2026-10-02 it sits under "Do this first" (ActionCard) as the shorter, cooler card (Jonno: "main next action card
 * top left, shorter next suggested application card just below it"): logo, company, role, days left and fit ring on one
 * band, then Go for it · Not interested (bins it for good, with Undo) · Later (waves it past for now via `?skip=`, URL
 * state). Either way the card flicks away and the next one rises from behind it (view transition `skip`, globals.css).
 */
import Link from "next/link";
import { ViewTransition } from "react";
import { Logo, SportStamp } from "./primitives";
import { StartButton } from "./StartButton";
import { FitRing } from "./FitRing";
import { NotInterested } from "./NotInterested";
import type { Suggestion } from "@/lib/queries";

function when(days: number | null): { text: string; hot: boolean } {
  if (days === null) return { text: "", hot: false };   // no number means no deadline
  if (days === 0) return { text: "Closes today", hot: true };
  return { text: `${days} day${days === 1 ? "" : "s"} left`, hot: days <= 7 };
}

const CARD = { enter: { skip: "card-in", default: "none" }, exit: { skip: "card-out", default: "none" } };

export function SuggestCard({ pick, skip, skipHref }: {
  pick: Suggestion | undefined; skip: number[]; skipHref: (ids: number[]) => string;
}) {
  if (!pick) {
    return (
      <ViewTransition key="none" enter={CARD.enter} exit={CARD.exit} default="none">
        <section className="sg sg--empty" aria-label="Up next">
          <span className="sg-eye">Up next</span>
          <p className="sg-t">That&apos;s every pick for now.</p>
          {skip.length ? <Link href={skipHref([])} transitionTypes={["skip"]} className="sg-skip">Start over</Link> : null}
        </section>
      </ViewTransition>
    );
  }
  const s = pick;
  const w = when(s.days);
  return (
    <ViewTransition key={s.id} enter={CARD.enter} exit={CARD.exit} default="none">
      <section className="sg" aria-label="Up next" data-sport={s.sport ? "1" : undefined}>
        <Link href={`/jobs/${s.id}`} transitionTypes={["nav-forward"]} className="sg-hit">
          <Logo company={{ name: s.company, logoUrl: s.logoUrl, domain: s.domain }} size={44} />
          <span className="sg-name">
            <span className="sg-eye">Up next</span>
            <span className="sg-co">{s.company}</span>
            <span className="sg-t">{s.title}</span>
          </span>
          <span className="sg-side">
            <FitRing score={s.rankScore} rankPos={s.rankPos} size={46} />
            {w.text ? <span className="sg-when" data-hot={w.hot ? "1" : undefined}>{w.text}</span> : null}
          </span>
        </Link>

        <div className="sg-acts">
          <StartButton jobId={s.id} company={s.company} />
          <NotInterested variant="card" jobId={s.id} company={s.company} status={s.status}
                         nextHref={skipHref([...skip, s.id])} />
          {s.sport ? <SportStamp /> : null}
          <Link href={skipHref([...skip, s.id])} transitionTypes={["skip"]} scroll={false} className="sg-skip"
                title="Not now: show the next pick, keep this one">
            Later
          </Link>
        </div>
      </section>
    </ViewTransition>
  );
}
