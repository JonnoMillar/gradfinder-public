"use client";

/**
 * The Climb's frame and its controls (Jonno 2026-11-10):
 *
 *  - "View graveyard", always there. It pans the camera down: the world (head, stairs, graveyard: one drawing) slides
 *    up, so the stairs go up and mostly out of shot and the graves under them come into view. The same button says
 *    "Back to the climb" there, and scrolling up over the scene goes back too (that wheel turn is spent on the pan, not
 *    the page). Scrolling down never opens it: the page scrolls. ClimbReveal opens the graveyard itself to bury a new
 *    rejection, through the `gf:graveyard` event.
 *  - "Replay": the card grows to show the whole world, stairs and graveyard at once, and ClimbReplay plays every
 *    application's journey from the activity log; it calls `stop` at the end and the card goes back.
 *
 * The drawing stays a server render passed in as children; ClimbReplay (inside it) reads the replay state from context.
 */
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

export const GRAVEYARD_EVENT = "gf:graveyard";
/** open (true) or close (false) the graveyard view from anywhere on the page */
export const showGraveyard = (open: boolean) => window.dispatchEvent(new CustomEvent(GRAVEYARD_EVENT, { detail: open }));

const Replay = createContext<{ playing: boolean; stop: () => void }>({ playing: false, stop: () => {} });
export const useReplay = () => useContext(Replay);

type View = "climb" | "grave" | "all";

export function ClimbStage({ buried, canReplay, children }: { buried: number; canReplay: boolean; children: ReactNode }) {
  const [view, setView] = useState<View>("climb");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const on = (e: Event) => setView((v) => (v === "all" ? v : (e as CustomEvent<boolean>).detail ? "grave" : "climb"));
    window.addEventListener(GRAVEYARD_EVENT, on);
    return () => window.removeEventListener(GRAVEYARD_EVENT, on);
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el || view !== "grave") return;
    // non-passive, so the turn that goes back up doesn't also scroll the page
    const wheel = (e: WheelEvent) => { if (e.deltaY < -4) { e.preventDefault(); setView("climb"); } };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [view]);
  useEffect(() => {
    // once the card has grown, bring all of it into view
    if (view !== "all") return;
    const t = setTimeout(() => ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }), 1150);
    return () => clearTimeout(t);
  }, [view]);

  const playing = view === "all";
  return (
    <Replay.Provider value={{ playing, stop: () => setView("climb") }}>
      <div className="cl-stage" ref={ref} data-view={view === "climb" ? undefined : view}>
        {children}
        <div className="cl-ctl">
          {playing ? (
            <button type="button" className="cl-endbtn" onClick={() => setView("climb")}>
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4.5 4.5h7v7h-7z" /></svg>
              Stop replay
            </button>
          ) : (
            <>
              {canReplay ? (
                <button type="button" className="cl-endbtn" onClick={() => setView("all")} title="Every application's journey, from the first">
                  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M5 3.5v9l7-4.5z" /></svg>
                  Replay
                </button>
              ) : null}
              <button type="button" className="cl-endbtn" aria-pressed={view === "grave"} onClick={() => setView((v) => (v === "grave" ? "climb" : "grave"))}
                      title={view === "grave" ? "Or scroll up over the scene" : undefined}>
                <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                  <path d="M4 14V6.5a4 4 0 0 1 8 0V14z" /><path d="M2.5 14h11" />
                </svg>
                {view === "grave" ? <>Back to the climb <em aria-hidden="true">↑</em></>
                  : <>View graveyard {buried ? <b>{buried}</b> : null} <em aria-hidden="true">↓</em></>}
              </button>
            </>
          )}
        </div>
      </div>
    </Replay.Provider>
  );
}
