"use client";
/**
 * The two documents every application uses, as two even tiles stacked in the left of the /kit hero: the CV (top,
 * cool) and the base cover letter (bottom, violet). A tile is a big icon, a title and its state, not a shrunken page:
 * the documents only open full size, in a modal <dialog> (Esc, the Close button or a click outside shuts it). The CV
 * opens fitted to the window, the whole page at a glance; a click zooms it to full width. The letter sits beside the
 * parts that change per role; a highlighted slot shows its options. The to-do list can open the letter (`kit:open`).
 */
import { useEffect, useRef, useState, useTransition } from "react";
import { letterApprovalAction } from "@/app/actions";
import { IconCv, IconExternal, IconLetter } from "@/lib/ui/icons";
import type { KitLetter } from "@/lib/kit";
import { letterSlots } from "@/lib/kit-slots";
import { PdfSheet } from "./PdfSheet";

type Doc = "cv" | "letter";

const ExpandIcon = () => (
  <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9.5 2.5h4v4M6.5 13.5h-4v-4" /><path d="m13.5 2.5-4.5 4.5M2.5 13.5 7 9" />
  </svg>
);

export function KitDocs({ cv, letter }: {
  cv: { pages: number; updated: string } | null;
  letter: KitLetter | null;
}) {
  const [open, setOpen] = useState<Doc | null>(null);
  const [approved, setApproved] = useState(letter?.approved ?? false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const dlg = useRef<HTMLDialogElement>(null);
  const [zoomed, setZoomed] = useState(false); // CV: fit the whole page (default) or full width
  const [pick, setPick] = useState<string | null>(null); // letter: the group of options the clicked slot opened

  /** The options group a slot is filled from: the one whose codes (R1, B1, …) the slot names. */
  const groupFor = (slot: string) =>
    letter?.pieces.find((g) => g.items.some((it) => new RegExp(`\\b${it.code}\\b`).test(slot)))?.heading ?? null;
  const choose = (heading: string) => {
    setPick(heading);
    document.getElementById(`kx-pc-${heading.replace(/\W+/g, "-")}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  useEffect(() => {
    const d = dlg.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
    if (!open) { setZoomed(false); setPick(null); }
  }, [open]);

  useEffect(() => {
    const onOpen = (e: Event) => setOpen((e as CustomEvent<Doc>).detail);
    window.addEventListener("kit:open", onOpen);
    return () => window.removeEventListener("kit:open", onOpen);
  }, []);

  const approve = (value: boolean) => start(async () => {
    setErr(null);
    const r = await letterApprovalAction({ approve: value });
    if (r.ok) setApproved(value); else setErr(r.error);
  });

  const approveBtn = letter
    ? approved
      ? <button type="button" className="kx-btn" disabled={pending} onClick={() => approve(false)}>Undo approval</button>
      : <button type="button" className="kx-btn kx-btn--go" disabled={pending} onClick={() => approve(true)}>Approve letter</button>
    : null;

  return (
    <>
      <div className="kx-tiles">
        <section className="kx-tile" data-doc="cv" aria-labelledby="tile-cv">
          <button type="button" className="kx-tile-hit" onClick={() => setOpen("cv")} disabled={!cv}>
            <span className="kx-tile-ic"><IconCv /></span>
            <span className="kx-tile-t">
              <b id="tile-cv">CV</b>
              <span>{cv ? `The file every Apply run uploads. Updated ${cv.updated}.` : "No CV in profile/cv, so Apply runs can't upload one."}</span>
            </span>
          </button>
          <footer className="kx-tile-f">
            {cv ? <span className="kx-pill" data-tone={cv.pages === 1 ? "ok" : "bad"}>{cv.pages === 1 ? "1 page" : `${cv.pages} pages`}</span> : null}
            {cv ? <button type="button" className="kx-tile-go" onClick={() => setOpen("cv")}><ExpandIcon /> Open</button> : null}
            {cv ? <a className="kx-link" href="/kit/cv" target="_blank" rel="noreferrer">PDF <IconExternal /></a> : null}
          </footer>
        </section>

        <section className="kx-tile" data-doc="letter" aria-labelledby="tile-letter">
          <button type="button" className="kx-tile-hit" onClick={() => setOpen("letter")} disabled={!letter}>
            <span className="kx-tile-ic"><IconLetter /></span>
            <span className="kx-tile-t">
              <b id="tile-letter">Cover letter</b>
              <span>{letter ? "The base every letter starts from. Highlighted parts are written for each role." : "No base letter in profile/cover-letters yet."}</span>
            </span>
          </button>
          <footer className="kx-tile-f">
            {letter ? <span className="kx-pill" data-tone={approved ? "ok" : "warn"}>{approved ? "Approved" : "Draft"}</span> : null}
            {letter ? <button type="button" className="kx-tile-go" onClick={() => setOpen("letter")}><ExpandIcon /> Open</button> : null}
            {!approved ? approveBtn : null}
          </footer>
          {err ? <p className="kx-err" role="alert">{err}</p> : null}
        </section>
      </div>

      <dialog ref={dlg} className="kx-dlg" data-doc={open ?? undefined} data-zoom={zoomed || undefined} aria-label={open === "cv" ? "CV" : "Base cover letter"}
        onClose={() => setOpen(null)} onClick={(e) => { if (e.target === e.currentTarget) setOpen(null); }}>
        {open ? (
          <div className="kx-dlg-in">
            <header className="kx-dlg-h">
              <h2>{open === "cv" ? "CV" : "Cover letter"}</h2>
              {open === "cv" && cv ? <span className="kx-pill" data-tone={cv.pages === 1 ? "ok" : "bad"}>{cv.pages === 1 ? "1 page" : `${cv.pages} pages`}</span> : null}
              {open === "letter" ? <span className="kx-pill" data-tone={approved ? "ok" : "warn"}>{approved ? "Approved" : "Draft"}</span> : null}
              <span className="kx-doc-acts">
                {open === "cv" ? <a className="kx-btn" href="/kit/cv" target="_blank" rel="noreferrer">Open the PDF <IconExternal /></a> : approveBtn}
                <button type="button" className="kx-btn" onClick={() => setOpen(null)} autoFocus>Close</button>
              </span>
            </header>
            {err && open === "letter" ? <p className="kx-err" role="alert">{err}</p> : null}

            {open === "cv" ? (
              <button type="button" className="kx-sheet-btn" onClick={() => setZoomed((z) => !z)}
                aria-label={zoomed ? "Fit the whole page in the window" : "Zoom to full width"}>
                <PdfSheet src="/kit/cv" label="Your CV, page 1" />
              </button>
            ) : null}

            {open === "letter" && letter ? (
              <div className="kx-ltr">
                <div>
                  <article className="kx-paper kx-letter">
                    {letter.letter.map((p, i) => (
                      <p key={i}>{letterSlots(p).map((s, j) => {
                        const g = groupFor(s.text);
                        return !s.slot ? s.text : g
                          ? <button key={j} type="button" className="kx-slot" data-on={pick === g || undefined} onClick={() => choose(g)}>{s.text}</button>
                          : <mark key={j} className="kx-slot">{s.text}</mark>;
                      })}</p>
                    ))}
                  </article>
                  <p className="kx-doc-foot">Every letter starts from this. <mark className="kx-slot">Highlighted</mark> parts are written for each role; click one to see its options.</p>
                </div>
                {letter.pieces.length ? (
                  <aside className="kx-pieces" aria-label="Parts that change per role">
                    {letter.pieces.map((g) => (
                      <section key={g.heading} id={`kx-pc-${g.heading.replace(/\W+/g, "-")}`} data-on={pick === g.heading || undefined}>
                        <h3>{g.heading}{g.hint ? <span>{g.hint.replace(/^./, (c) => c.toUpperCase())}</span> : null}</h3>
                        <div className="kx-piece-grid">
                          {g.items.map((it) => (
                            <article key={it.code} className="kx-piece">
                              <h4><b>{it.code}</b> {it.label.replace(/^./, (c) => c.toUpperCase())}</h4>
                              <p>{it.isDefault ? "The one in the letter (the default)." : it.text}</p>
                            </article>
                          ))}
                        </div>
                      </section>
                    ))}
                  </aside>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </dialog>
    </>
  );
}
