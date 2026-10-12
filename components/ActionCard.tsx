/**
 * Do this first (Jonno 2026-10-02): the top-left card on Roles, above Up next. Once applications are in, the urgent
 * thing is rarely a new one: it is the HireVue or online test a recruiter set, with a date. So this card shows the one
 * most urgent dated item from `attention()` (lib/tracker/attention.ts, the same rules as the Applications page): a
 * recruiter's ask from the Gmail sync, his own dated step, or a started application's closing date.
 *
 * Big countdown, the task, who it is for, and the buttons to do it (open the email, tick it done, open the role). It is
 * the warm, loud card; Up next below it is the cool, quieter one. Its colour follows the urgency: hot today, tomorrow or
 * late; warm within a week; calm beyond. Nothing dated: a short all-clear, so Up next leads.
 */
import Link from "next/link";
import { Logo } from "./primitives";
import { ActionDoneButton } from "./ActionDoneButton";
import { IconClock, IconExternal, IconTarget, IconTests, IconVideo } from "@/lib/ui/icons";
import { fmtDate } from "@/lib/ui/format";
import type { AttentionItem } from "@/lib/tracker/attention";

/** What kind of task it is, read off the words: the icon and a short label. */
function kindOf(i: AttentionItem): { Icon: typeof IconTests; word: string } {
  if (i.kind === "deadline") return { Icon: IconClock, word: "Applications close" };
  // HireVue before "assessment": "the HireVue pre-interview" is a video; "pre-interview assessment" alone is a test
  if (/hire ?vue|video|recorded interview/i.test(i.text)) return { Icon: IconVideo, word: "Video interview" };
  if (/assess|test|game|shl|pymetrics|numerical|verbal|cognitive/i.test(i.text)) return { Icon: IconTests, word: "Online test" };
  if (i.kind === "email") return { Icon: IconTarget, word: "Recruiter asked" };
  return { Icon: IconTarget, word: "Your step" };
}

function Countdown({ days }: { days: number }) {
  if (days < 0) return <span className="ac-n"><b>{-days}</b><span>day{days === -1 ? "" : "s"} late</span></span>;
  if (days === 0) return <span className="ac-n"><b data-word="1">Today</b></span>;
  if (days === 1) return <span className="ac-n"><b data-word="1">Tomorrow</b></span>;
  return <span className="ac-n"><b>{days}</b><span>days left</span></span>;
}

export function ActionCard({ items }: { items: AttentionItem[] }) {
  const [i] = items;
  if (!i) {
    return (
      <section className="ac ac--clear" aria-label="Do this first">
        <span className="ac-eye">Do this first</span>
        <p className="ac-clear"><b>Nothing due.</b> No test, interview or step has a date on it. Send the next one below.</p>
      </section>
    );
  }
  const { Icon, word } = kindOf(i);
  const heat = i.days <= 1 ? "hot" : i.days <= 7 ? "warm" : "calm";
  const what = i.kind === "deadline" ? `Finish and send ${i.title ?? "the application"}` : i.text;
  const soon = items.slice(1).filter((x) => x.days <= 7).length;

  return (
    <section className="ac" data-heat={heat} aria-label="Do this first">
      <div className="ac-top">
        <span className="ac-eye">{heat === "hot" ? <span className="now-pulse" aria-hidden="true" /> : null}Do this first</span>
        <span className="ac-kind"><Icon width={14} height={14} /> {word}</span>
      </div>

      <div className="ac-body">
        <Countdown days={i.days} />
        <div className="ac-what">
          <p>{what}</p>
          <span className="ac-who">
            <Logo company={{ name: i.company, logoUrl: i.logoUrl, domain: i.domain }} size={20} />
            {i.jobId ? <Link href={`/jobs/${i.jobId}`} transitionTypes={["nav-forward"]}>{i.company}</Link> : <span>{i.company}</span>}
            <span className="ac-date">due {fmtDate(i.date)}</span>
          </span>
        </div>
      </div>

      <div className="ac-acts">
        {i.email?.viewUrl ? (
          <a href={i.email.viewUrl} target="_blank" rel="noreferrer" className="ac-go">
            Open the email <IconExternal width={13} height={13} />
          </a>
        ) : i.jobId ? (
          <Link href={`/jobs/${i.jobId}`} transitionTypes={["nav-forward"]} className="ac-go">Open the role</Link>
        ) : null}
        {i.email ? <ActionDoneButton id={i.email.id} done={false} /> : null}
        {soon ? (
          <Link href="/applications" transitionTypes={["tab"]} className="ac-more">
            +{soon} more due this week →
          </Link>
        ) : null}
      </div>
    </section>
  );
}
