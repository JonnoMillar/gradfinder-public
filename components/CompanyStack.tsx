"use client";

/**
 * Several roles at one company, as one card (Jonno 2026-09-28: "jobs for the same company should be grouped … arrows on
 * the card so you can click through"). The edges of the cards underneath peek out to say there are more, and a small
 * pager on the bottom edge flips through them.
 *
 * A flip is a small change, so it looks like one (Jonno 2026-09-29: a whole new card "suggests too much change for
 * just a role change"). The card, logo and company name stay where they are; only the parts that differ between
 * roles (marked `data-slide` in JobRow: deadline, role, fit ring, detail line) slide out and the next role's slide in
 * behind them. On a touch screen those parts follow the finger and a swipe past the threshold flips.
 * Keyboard: the pager buttons, or ←/→ while focus is anywhere in the card. Reduced motion: a short crossfade.
 *
 * The cards are rendered on the server (JobRow) and handed in as `cards`, so the tile stays one component.
 */
import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { reducedMotion } from "./motion";

const EXPO = "cubic-bezier(0.16, 1, 0.3, 1)";
const SWIPE = 64;

type Flip = { from: number; dir: 1 | -1; start: number; n: number };

/** the parts of a tile that change between roles */
const parts = (el: HTMLElement | null) => (el ? [...el.querySelectorAll<HTMLElement>("[data-slide]")] : []);
const SHIFT = 44;

export function CompanyStack({ company, cards }: { company: string; cards: ReactNode[] }) {
  const n = cards.length;
  const [at0, setI] = useState(0);
  // a card binned (Not interested) shrinks the deck under the pager: stay in range
  const i = Math.min(at0, n - 1);
  const [flip, setFlip] = useState<Flip | null>(null);
  const top = useRef<HTMLDivElement>(null);
  const out = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; dx: number; id: number; moved: boolean } | null>(null);

  const at = useRef(0);
  const go = useCallback((dir: 1 | -1, start = 0) => {
    const from = Math.min(at.current, n - 1);
    at.current = (from + dir + n) % n;
    setFlip({ from, dir, start, n: performance.now() });
    setI(at.current);
  }, [n]);

  useLayoutEffect(() => {
    if (!flip || !top.current) return;
    const inc = parts(top.current), old = parts(out.current);
    const done = () => setFlip((f) => (f?.n === flip.n ? null : f));
    const settle = (a: Animation[]) => Promise.all(a.map((x) => x.finished)).then(done, done);
    if (reducedMotion()) {
      inc.forEach((e) => e.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160 }));
      settle(old.map((e) => e.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: "forwards" })));
      return;
    }
    // next: the old role leaves to the left and the new one comes in from the right; back is the mirror image.
    // A swipe starts from wherever the finger let go.
    const d = flip.dir, x0 = flip.start;
    settle(old.map((e, k) => e.animate(
      [{ transform: `translateX(${x0}px)`, opacity: 1, filter: "blur(0)" },
       { transform: `translateX(${x0 - d * SHIFT}px)`, opacity: 0, filter: "blur(2px)" }],
      { duration: 200, easing: "cubic-bezier(0.4, 0, 1, 1)", delay: k * 18, fill: "forwards" })));
    inc.forEach((e, k) => e.animate(
      [{ transform: `translateX(${d * SHIFT}px)`, opacity: 0 }, { transform: "none", opacity: 1 }],
      { duration: 420, easing: EXPO, delay: 90 + k * 30, fill: "backwards" }));
  }, [flip]);

  // touch: the role's parts follow the finger; a swipe past SWIPE px flips, anything less springs back
  const onDown = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse" || n < 2) return;
    drag.current = { x: e.clientX, y: e.clientY, dx: 0, id: e.pointerId, moved: false };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId || !top.current) return;
    d.dx = e.clientX - d.x;
    if (!d.moved && Math.abs(d.dx) > 8 && Math.abs(d.dx) > Math.abs(e.clientY - d.y)) {
      d.moved = true;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }
    if (d.moved) for (const p of parts(top.current)) p.style.transform = `translateX(${d.dx}px)`;
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d?.moved || !top.current) return;
    const ps = parts(top.current);
    for (const p of ps) p.style.transform = "";
    if (Math.abs(d.dx) >= SWIPE) {
      go(d.dx < 0 ? 1 : -1, d.dx);
    } else {
      for (const p of ps) p.animate([{ transform: `translateX(${d.dx}px)` }, { transform: "none" }], { duration: 320, easing: EXPO });
    }
    // swallow the click that ends a drag, so a swipe never opens the role
    const stop = (ev: Event) => { ev.preventDefault(); ev.stopPropagation(); };
    top.current.addEventListener("click", stop, { capture: true, once: true });
    setTimeout(() => top.current?.removeEventListener("click", stop, { capture: true }), 0);
  };

  return (
    <div className="cdeck" data-n={Math.min(n, 3)} role="group" aria-roledescription="carousel"
         aria-label={`${n} roles at ${company}`}
         onKeyDown={(e) => {
           if (e.key === "ArrowRight") { e.preventDefault(); go(1); }
           if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
         }}>
      <div className="stack-deck" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        <div ref={top} className="stack-top" aria-roledescription="slide" aria-label={`${i + 1} of ${n}`}>
          {cards[i]}
        </div>
        {flip ? (
          <div ref={out} className="stack-out" inert>
            {cards[flip.from]}
          </div>
        ) : null}
      </div>

      <div className="stack-nav">
        <button type="button" onClick={() => go(-1)} aria-label={`Previous ${company} role`}>
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M10 3.5 5.5 8l4.5 4.5" /></svg>
        </button>
        {n <= 6 ? (
          <span className="stack-dots" aria-hidden="true">
            {cards.map((_, k) => <i key={k} data-on={k === i ? "1" : undefined} />)}
          </span>
        ) : (
          <span className="stack-count" aria-hidden="true">{i + 1}<span>/{n}</span></span>
        )}
        <button type="button" onClick={() => go(1)} aria-label={`Next ${company} role`}>
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5" /></svg>
        </button>
        <span className="sr" aria-live="polite">{`${company}: role ${i + 1} of ${n}`}</span>
      </div>
    </div>
  );
}
