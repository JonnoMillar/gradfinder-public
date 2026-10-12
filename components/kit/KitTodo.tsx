"use client";
/**
 * "Waiting on you" on /kit: everything only Jonno can do, each with why it matters and a way to do it right here.
 * Drafts open in place on white paper with Approve; open questions from questions.md take a typed answer or a
 * one-click option, and write it back to the store (answerGapAction) with a few seconds to Undo before the list
 * refreshes. Long groups show their first few items and the rest behind "Show N more".
 */
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { answerGapAction, reviewAnswerAction, unanswerGapAction } from "@/app/actions";
import { IconChevron } from "@/lib/ui/icons";
import type { KitGapGroup, KitGapItem } from "@/lib/kit";

export interface KitDraft { id: number; jobId: number; company: string; question: string; text: string; words: number }

const SHOW = 4;
const UNDO_MS = 6000;
const short = (q: string) => q.replace(/\s*\(.*$/, "").replace(/\?.*$/, "?");

/** Saved state with an Undo window; the page refreshes (and the item drops off) once the window closes. */
function useSaved() {
  const router = useRouter();
  const [saved, setSaved] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return {
    saved,
    mark(text: string) { setSaved(text); timer.current = setTimeout(() => router.refresh(), UNDO_MS); },
    clear() { if (timer.current) clearTimeout(timer.current); setSaved(null); },
  };
}

function Done({ text, onUndo, busy }: { text: string; onUndo: () => void; busy: boolean }) {
  return (
    <div className="kx-done" role="status">
      <span className="kx-done-tick" aria-hidden="true">✓</span>
      <span className="kx-done-t">{text}</span>
      <button type="button" className="kx-link" onClick={onUndo} disabled={busy}>Undo</button>
    </div>
  );
}

function GapRow({ item }: { item: KitGapItem }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const s = useSaved();

  const save = (answer: string) => start(async () => {
    setErr(null);
    const r = await answerGapAction({ raw: item.raw, answer });
    if (r.ok) { setOpen(false); s.mark(answer); } else setErr(r.error);
  });
  const undo = () => start(async () => {
    const r = await unanswerGapAction({ raw: item.raw, answer: s.saved ?? "" });
    if (r.ok) s.clear(); else setErr(r.error);
  });

  if (s.saved != null) return <li className="kx-row"><Done text={`Saved: “${s.saved}”`} onUndo={undo} busy={busy} /></li>;

  return (
    <li className="kx-row" data-open={open || undefined}>
      <div className="kx-row-main">
        <div className="kx-row-t">
          <h4>{item.title}</h4>
          {item.detail ? <p className="kx-row-q">{item.detail.replace(/^./, (c) => c.toUpperCase())}</p> : null}
          {item.why ? <p>{item.why}</p> : null}
        </div>
        <div className="kx-row-acts">
          {item.options?.map((o) => (
            <button key={o} type="button" className="kx-chip" disabled={busy} onClick={() => save(o)}>{o}</button>
          ))}
          {item.link ? <a className="kx-btn" href={item.link}>Open role <IconChevron /></a> : null}
          <button type="button" className={item.options?.length ? "kx-link" : "kx-btn kx-btn--warm"} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            {open ? "Close" : item.options?.length ? "Other answer" : "Answer"}
          </button>
        </div>
      </div>
      {open ? (
        <form className="kx-answer" onSubmit={(e) => { e.preventDefault(); save(text); }}>
                    {item.todo ? <p className="kx-answer-do">{item.todo}</p> : null}
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} autoFocus
            placeholder="Your answer, in your own words" aria-label={`Answer: ${item.title}`} />
          <div className="kx-answer-acts">
            <button type="submit" className="kx-btn kx-btn--go" disabled={busy || !text.trim()}>{busy ? "Saving…" : "Save answer"}</button>
            <span>Saved to your store as your own words.</span>
          </div>
          {err ? <p className="kx-err" role="alert">{err}</p> : null}
        </form>
      ) : err ? <p className="kx-err" role="alert">{err}</p> : null}
    </li>
  );
}

function DraftRow({ d }: { d: KitDraft }) {
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const s = useSaved();
  const review = (approve: boolean) => start(async () => {
    setErr(null);
    const r = await reviewAnswerAction({ id: d.id, text: d.text, approve, jobId: d.jobId });
    if (!r.ok) return setErr(r.error);
    if (approve) { setOpen(false); s.mark("approved"); } else s.clear();
  });

  if (s.saved) return <li className="kx-row"><Done text={`Approved: ${d.company}, ${short(d.question)}`} onUndo={() => review(false)} busy={busy} /></li>;

  return (
    <li className="kx-row" data-open={open || undefined}>
      <div className="kx-row-main">
        <div className="kx-row-t">
          <h4>{d.company} <span>· {short(d.question)}</span></h4>
          <p>{d.words} words, drafted by an Apply run. It won&apos;t go into a form until you approve it.</p>
        </div>
        <div className="kx-row-acts">
          <button type="button" className="kx-btn kx-btn--warm" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            {open ? "Close" : "Read and approve"}
          </button>
        </div>
      </div>
      {open ? (
        <div className="kx-answer">
          <p className="kx-answer-q">{d.question}</p>
          <article className="kx-paper kx-paper--answer">{d.text.split(/\n\s*\n/).map((p, i) => <p key={i}>{p}</p>)}</article>
          <div className="kx-answer-acts">
            <button type="button" className="kx-btn kx-btn--go" disabled={busy} onClick={() => review(true)}>{busy ? "Approving…" : "Approve as it is"}</button>
            <a className="kx-btn" href={`/jobs/${d.jobId}#answers-h`}>Edit on the role page <IconChevron /></a>
          </div>
          {err ? <p className="kx-err" role="alert">{err}</p> : null}
        </div>
      ) : err ? <p className="kx-err" role="alert">{err}</p> : null}
    </li>
  );
}

function Group({ why, children }: { why?: string; children: React.ReactNode[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? children : children.slice(0, SHOW);
  return (
    <div className="kx-grp">
      {why ? <p className="kx-grp-why">{why}</p> : null}
      <ul className="kx-rows">{shown}</ul>
      {children.length > SHOW ? (
        <button type="button" className="kx-more-btn" onClick={() => setAll((v) => !v)} aria-expanded={all}>
          {all ? "Show fewer" : `Show ${children.length - SHOW} more`}
        </button>
      ) : null}
    </div>
  );
}

/** One group at a time behind tabs, so the list never runs to dozens of rows. `#q-…` links (the hero summary) pick a tab. */
export function KitTodo({ drafts, letterDraft, groups }: { drafts: KitDraft[]; letterDraft: boolean; groups: (KitGapGroup & { id: string; tone: string })[] }) {
  const [active, setActive] = useState<string | null>(null);
  const box = useRef<HTMLElement>(null);
  useEffect(() => {
    const pick = (scroll: boolean) => {
      const id = decodeURIComponent(location.hash.slice(1));
      if (!id.startsWith("q-")) return;
      setActive(id);
      if (scroll) box.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    pick(false);
    const onHash = () => pick(true);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const approvals = [
    ...(letterDraft ? [(
      <li key="letter" className="kx-row">
        <div className="kx-row-main">
          <div className="kx-row-t">
            <h4>Base cover letter</h4>
            <p>Every cover letter starts from this one. Read it, then approve it at the top of the letter.</p>
          </div>
          <div className="kx-row-acts">
            <button type="button" className="kx-btn kx-btn--warm" onClick={() => window.dispatchEvent(new CustomEvent("kit:open", { detail: "letter" }))}>
              Read the letter
            </button>
          </div>
        </div>
      </li>
    )] : []),
    ...drafts.map((d) => <DraftRow key={d.id} d={d} />),
  ];
  const tabs = [
    ...(approvals.length ? [{ id: OK_ID, title: OK_TITLE, why: OK_WHY, tone: "warm", rows: approvals }] : []),
    ...groups.map((g) => ({ id: g.id, title: g.heading, why: g.why, tone: g.tone, rows: g.items.map((it) => <GapRow key={it.raw} item={it} />) })),
  ];
  if (!tabs.length) return null;
  const cur = tabs.find((t) => t.id === active) ?? tabs[0];
  const choose = (id: string) => { setActive(id); history.replaceState(null, "", `#${id}`); };

  return (
    <section ref={box} id="todo" className="kx-todo" aria-labelledby="todo-h">
      <header className="kx-sec-h">
        <h2 id="todo-h">Questions</h2>
        <p>Only you can answer these. Answers save straight to your store, so Claude stops asking mid-application.</p>
      </header>
      <div className="kx-tabs" role="tablist" aria-label="Question groups">
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" className="kx-tab" style={{ "--g": `var(--${t.tone})` } as React.CSSProperties}
            aria-selected={t.id === cur.id} aria-controls="todo-panel" onClick={() => choose(t.id)}>
            {t.title} <span className="kx-num">{t.rows.length}</span>
          </button>
        ))}
      </div>
      <div id="todo-panel" role="tabpanel" aria-label={cur.title} style={{ "--g": `var(--${cur.tone})` } as React.CSSProperties}>
        <Group key={cur.id} why={cur.why}>{cur.rows}</Group>
      </div>
    </section>
  );
}

const OK_ID = "q-ok";
const OK_TITLE = "Ready for your OK";
const OK_WHY = "Drafts Claude wrote. Nothing goes into a form until you approve it.";
