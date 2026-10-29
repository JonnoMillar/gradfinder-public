/**
 * The climb (Jonno 2026-10-02): the whole pipeline as a staircase of floating cubes rising to the grad offer, so the
 * numbers build into something you can see rather than sitting in cards.
 *
 *  - One cube per stage, left to right and rising: To send (interested + applying) → Sent → Tests → HireVue → Interview. The
 *    stage's icon is engraved on its right face and its count on its left face. A stage with nobody on it is a faint
 *    ghost, so the stairs light up as roles move along.
 *  - The summit is the Offer: a bigger gold cube with the flag on it and a halo behind, gold even when empty, because
 *    it is the point of the whole climb (Jonno: "more aspirational").
 *  - On top of each cube sits a pile of small cubes, one per role at that stage (hover for the company, click to open
 *    it). Three by three a layer, so twenty applications read as piles, not a table.
 *  - Live applications (sent and still in play) glow: a mint light under each live stage that has roles, and the count
 *    beside the headline. The headline itself is the total sent (a rejection still counts as one made); the 40 target
 *    is one quiet line (Jonno: "I don't really care about it that much").
 *  - Rejections (the only ending worth a glance; closed and binned roles live in the archive below): one quiet control at
 *    the foot, "2 rejected". Hover it, or click to keep it open (components/ClimbStage.tsx), and a dashed outline of a
 *    mini cube per rejected role appears on top of the stage it had reached, then falls to the floor beneath it
 *    (`endedFrom()` in lib/queries.ts says which stage). Same size as the roles piled on a stage, piled the same way.
 *
 * Pure SVG from the server, plus CSS: the cubes rise in sequence, the small ones drop onto them, the lights come up.
 * All of it is off under reduced motion. A fixed 960×430 drawing; below ~800px it scrolls sideways rather than shrinking.
 */
import type { ApplicationRow } from "@/lib/queries";
import { GOAL_BY, GOAL_TOTAL } from "@/lib/tracker/goals";
import { SUBMITTED } from "@/lib/tracker/attention";
import { fmtDate } from "@/lib/ui/format";
import { cube, faces, r1, ICON, STAIRS, type Cube } from "@/lib/ui/cubes";
import { ClimbStage } from "./ClimbStage";

// ------------------------------------------------------------------------------------------- geometry
const STEP = cube(42);
const MINI = cube(9.5);
const PEAK = cube(62);
const X0 = 70, DX = 142, Y0 = 290, DY = 28;
const PEAK_X = 826;

// ------------------------------------------------------------------------------------------- stages
/** the first layer fills from the middle out, so a few roles look like a heap and not a row */
const CELLS = [[1, 1], [0, 1], [1, 0], [2, 1], [1, 2], [0, 0], [2, 2], [0, 2], [2, 0]] as const;
/** on the summit the back cell holds the flag */
const PEAK_CELLS = CELLS.filter(([u, v]) => u + v > 0);

/** a list row: where a mini's centre lands when its stage is in focus, and its company name beside it */
type Row = { x: number; y: number };
/**
 * Where a stage's list may go: the open sky above and left of its cube, which no other stage reaches because the stairs
 * climb to the right. `right`/`bottom` bound it; `high` is the lower edge to use instead when a long list has to be
 * pushed right past the cube's shoulder, so it stays above the next stage's pile.
 */
type Sky = { right: number; bottom: number; high: number };
const ROW_H = 21, COL_W = 160, NAME_MAX = 21;
const clip = (s: string) => (s.length > NAME_MAX ? `${s.slice(0, NAME_MAX - 1)}…` : s);

function Mini({ x, y, app, i, j, row }: { x: number; y: number; app: ApplicationRow; i: number; j: number; row: Row }) {
  const f = faces(x, y, MINI);
  const cy = y + MINI.h + MINI.H / 2;   // the mini's centre, which travels to the row's bullet
  return (
    <a href={`/jobs/${app.jobId}`} className="cl-mini"
       style={{ ["--i" as string]: i, ["--j" as string]: j, ["--dx" as string]: `${r1(row.x - x)}px`, ["--dy" as string]: `${r1(row.y - cy)}px` }}>
      <title>{`${app.company}: ${app.title}`}</title>
      <g className="cl-cube">
        <polygon points={f.left} className="cl-l" />
        <polygon points={f.right} className="cl-r" />
        <polygon points={f.top} className="cl-t" />
      </g>
      <text x={r1(row.x + 13)} y={r1(row.y + 4.3)} className="cl-name">{clip(app.company)}</text>
    </a>
  );
}

/**
 * The roles at a stage as small cubes piled on its top face, back to front within a layer, layer on layer. Each mini
 * also knows its row in the stage's list: on hover (or keyboard focus) the stage comes forward and the minis float off
 * the pile into a bulleted list of company names in the sky above it. The list never covers another stage, so the
 * pointer can walk up the stairs stage by stage (Jonno 2026-10-23: a list to the right sat on the next cube).
 */
function Pile({ x, y, c, apps, i, cells = CELLS, layers = 3, sky = { right: x + 60, bottom: y - 50, high: y - 85 } }: {
  x: number; y: number; c: Cube; apps: ApplicationRow[]; i: number; cells?: readonly (readonly [number, number])[]; layers?: number; sky?: Sky;
}) {
  const per = cells.length;
  const shown = Math.min(apps.length, per * layers);
  const extra = apps.length - shown;
  // the list: bottom-aligned just above the pile, columns growing leftwards, kept inside the drawing's left edge
  const lines = shown + (extra > 0 ? 1 : 0);
  const fit = (bottom: number) => {
    const rows = Math.max(1, Math.min(lines, Math.floor((bottom - 24) / ROW_H)));
    const cols = Math.ceil(lines / rows);
    return { rows, cols, bottom, right: Math.max(sky.right, 16 + cols * COL_W) };
  };
  let L = fit(sky.bottom);
  if (L.right > sky.right) L = fit(sky.high);
  const { rows, cols, right, bottom } = L;
  const top = bottom - rows * ROW_H;
  const rowAt = (n: number): Row => ({ x: right - (Math.floor(n / rows) + 1) * COL_W + 6, y: top + (n % rows) * ROW_H + ROW_H / 2 });

  const minis = apps.slice(0, shown).map((app, n) => {
    const layer = Math.floor(n / per);
    const [u, v] = cells[n % per];
    const cx = x + ((u + 0.5) / 3) * c.a - ((v + 0.5) / 3) * c.a;
    const cy = y + ((u + 0.5) / 3) * c.h + ((v + 0.5) / 3) * c.h - layer * MINI.H;
    return { app, layer, depth: u + v, x: cx, y: cy - MINI.h - MINI.H, n };
  }).sort((p, q) => p.layer - q.layer || p.depth - q.depth);
  if (!shown) return null;
  const more = rowAt(shown);
  // the hover target while focused: the list's box plus the cube's own column under it, so the pointer can go from cube
  // to list without losing focus, and nothing covers a neighbouring stage
  const listX = right - cols * COL_W - 6;
  return (
    <>
      <rect x={r1(listX)} y={r1(top - 6)} width={r1(right + 6 - listX)} height={r1(rows * ROW_H + 12)} className="cl-hit" />
      <rect x={r1(x - c.a - 16)} y={r1(bottom)} width={r1(2 * c.a + 32)} height={r1(y + 2 * c.h + c.H + 44 - bottom)} className="cl-hit" />
      {minis.map((m) => <Mini key={m.app.id} x={m.x} y={m.y} app={m.app} i={i} j={m.n} row={rowAt(m.n)} />)}
      {extra > 0 ? <text x={x + c.a + 4} y={y - 2 * MINI.H} className="cl-more">+{extra}</text> : null}
      {extra > 0 ? <text x={r1(more.x + 13)} y={r1(more.y + 4.3)} className="cl-name cl-name--more" style={{ ["--j" as string]: shown }}>+{extra} more</text> : null}
    </>
  );
}

/** A rejected application and whether the stage it had reached is recorded. An unrecorded one sits at Sent: it must have been sent. */
type Ended = { app: ApplicationRow; known: boolean };

/**
 * The rejections at a stage, shown on hover or when locked (ClimbStage): one dashed outline per role, the same size as
 * the roles piled on the stage. Each starts on the stage's top face and falls to the floor under its label. The heap
 * grows the way a stage's own does (3 x 3 a layer, three layers, then "+n"), so a long run of rejections still reads, and
 * a count in words sits under it. Shape and words carry the meaning, never hue.
 */
function Fallen({ x, y, stage, ends }: { x: number; y: number; stage: (typeof STAIRS)[number]; ends: Ended[] }) {
  const per = CELLS.length, layers = 3;
  const shown = Math.min(ends.length, per * layers);
  const extra = ends.length - shown;
  const { a, h, H } = MINI;
  const gy = y + 2 * STEP.h + STEP.H + 66;   // back corner of the floor heap, below the stage's label
  const cubes = ends.slice(0, shown).map((e, n) => {
    const layer = Math.floor(n / per);
    const [u, v] = CELLS[n % per];
    return { e, n, layer, depth: u + v, x: x + (u - v) * a, y: gy + (u + v) * h - layer * H };
  }).sort((p, q) => p.layer - q.layer || p.depth - q.depth);
  return (
    <g className="cl-fall">
      {cubes.map((c, k) => {
        const f = faces(c.x, c.y, MINI);
        // where it starts: on the stage's top face, spread a little so they don't begin as one
        const sx = x + ((c.n % 3) - 1) * 8, sy = y + STEP.h - MINI.h - MINI.H * 1.4;
        return (
          <a key={c.e.app.id} href={`/jobs/${c.e.app.jobId}`} className="cl-ghost"
             style={{ ["--n" as string]: k, ["--fx" as string]: `${r1(sx - c.x)}px`, ["--fy" as string]: `${r1(sy - c.y)}px` }}>
            <title>{`${c.e.app.company}: rejected${c.e.known ? ` at ${stage.label}` : " (stage not recorded)"}`}</title>
            <polygon points={f.left} /><polygon points={f.right} /><polygon points={f.top} />
          </a>
        );
      })}
      {extra > 0 ? <text x={x + 3 * a + 6} y={gy + 3 * h} className="cl-more cl-fall-lab">+{extra}</text> : null}
      <text x={x} y={gy + 6 * h + H + 17} className="cl-sub cl-fall-lab" textAnchor="middle">{ends.length} rejected</text>
    </g>
  );
}

function Engraving({ f, c, n, icon }: { f: ReturnType<typeof faces>; c: Cube; n: number; icon: string }) {
  const k = (1.375 * c.a) / 44;   // a 16-unit icon at 22px on a step cube, scaled with the cube
  return (
    <>
      <g transform={f.leftT}>
        <text x={c.a / 2} y={c.H * 0.7} className="cl-n" textAnchor="middle" style={{ fontSize: `${r1(c.a * 0.64)}px` }}>{n}</text>
      </g>
      <g transform={f.rightT}>
        <g transform={`translate(${r1(c.a / 2 - 8 * k)} ${r1(c.H / 2 - 8 * k)}) scale(${r1(k * 100) / 100})`} className="cl-ico">
          {ICON[icon].map((d) => <path key={d} d={d} />)}
        </g>
      </g>
    </>
  );
}

function Step({ i, stage, apps, live, ended }: { i: number; stage: (typeof STAIRS)[number]; apps: ApplicationRow[]; live: boolean; ended: boolean }) {
  const x = X0 + i * DX, y = Y0 - i * DY;
  const f = faces(x, y, STEP);
  const { h, H } = STEP;
  // a stage with a ticked half (tests_done, hirevue_done, interview_done): how many are still to do and how many done
  const done = apps.filter((p) => p.status !== stage.key).length;
  const sub = !apps.length || stage.statuses.length < 2 ? null
    : stage.key === "applying" ? [done && `${done} interested`, apps.length - done && `${apps.length - done} applying`].filter(Boolean).join(" · ")
    : `${apps.length - done} to ${stage.key === "tests" ? "sit" : "do"} · ${done} ${stage.key === "tests" ? "sat" : "done"}`;
  return (
    <g className="cl-step" data-s={stage.key} data-empty={apps.length ? undefined : "1"} data-pile={apps.length ? "1" : undefined} data-ends={ended ? "1" : undefined}
       style={{ ["--i" as string]: i, transformOrigin: `${x}px ${r1(y + h + H / 2)}px` }}>
      <title>{`${stage.label}: ${apps.length} role${apps.length === 1 ? "" : "s"}`}</title>
      {live && apps.length ? <polygon points={f.floor} className="cl-glow" filter="url(#cl-blur)" /> : null}
      <polygon points={f.left} className="cl-l" />
      <polygon points={f.right} className="cl-r" />
      <polygon points={f.top} className="cl-t" />
      <Engraving f={f} c={STEP} n={apps.length} icon={stage.key} />
      <Pile x={x} y={y} c={STEP} apps={apps} i={i} />
      <text x={x} y={y + 2 * h + H + 24} className="cl-lab" textAnchor="middle">{stage.label}</text>
      {sub ? <text x={x} y={y + 2 * h + H + 40} className="cl-sub" textAnchor="middle">{sub}</text> : null}
    </g>
  );
}

/** the summit: the grad offer, bigger and gold, with the flag planted on it */
function Peak({ apps }: { apps: ApplicationRow[] }) {
  const { a, h, H } = PEAK;
  const x = PEAK_X;
  // its base sits where a sixth step's would
  const y = Y0 - 5 * DY + (2 * STEP.h + STEP.H) - (2 * h + H);
  const f = faces(x, y, PEAK);
  const poleX = x, poleY = y + h * 0.62;
  return (
    <g className="cl-peak" data-s="offer" data-empty={apps.length ? undefined : "1"} data-pile={apps.length ? "1" : undefined}
       style={{ ["--i" as string]: 5, transformOrigin: `${x}px ${r1(y + h + H / 2)}px` }}>
      <title>{`Offer: ${apps.length}. The grad job.`}</title>
      <circle cx={x} cy={y + h + H / 2} r={a * 1.9} className="cl-halo" />
      {apps.length ? <polygon points={f.floor} className="cl-glow" filter="url(#cl-blur)" /> : null}
      <polygon points={f.left} className="cl-l" />
      <polygon points={f.right} className="cl-r" />
      <polygon points={f.top} className="cl-t" />
      <Engraving f={f} c={PEAK} n={apps.length} icon="offer" />
      <line x1={poleX} x2={poleX} y1={poleY} y2={poleY - 70} className="cl-pole" />
      <path d={`M${poleX} ${r1(poleY - 70)} h32 l-8 9.5 8 9.5 h-32 z`} className="cl-flag" />
      <Pile x={x} y={y} c={PEAK} apps={apps} i={5} cells={PEAK_CELLS} layers={1}
            sky={{ right: x - a - 14, bottom: 100, high: 100 }} />
      <text x={x} y={y + 2 * h + H + 26} className="cl-lab cl-lab--peak" textAnchor="middle">Offer</text>
      <text x={x} y={y + 2 * h + H + 43} className="cl-sub" textAnchor="middle">the grad job</text>
    </g>
  );
}

export function Climb({ apps, endedFrom = {} }: {
  apps: ApplicationRow[];
  /** status each rejected application moved from into its end (`endedFrom()` in lib/queries.ts) */
  endedFrom?: Record<number, string | null>;
}) {
  const at = (statuses: readonly string[]) => apps.filter((a) => statuses.includes(a.status));
  const ends = at(["rejected"]).map((app) => {
    const reached = STAIRS.find((s) => (s.statuses as readonly string[]).includes(endedFrom[app.id] ?? ""));
    return { app, known: !!reached, stage: reached ?? STAIRS[1] };
  });
  const sent = apps.filter((a) => a.appliedAt || SUBMITTED.includes(a.status)).length;
  const live = at(SUBMITTED).length;
  const offers = at(["offer"]);

  return (
    <section className="cl" aria-labelledby="cl-h">
      <div className="cl-scroll">
        <ClimbStage rejected={ends.length}>
          <div className="cl-head">
            <h2 id="cl-h" className="cl-eye">The climb</h2>
            <p className="cl-big"><b>{sent}</b><span>application{sent === 1 ? "" : "s"} sent</span></p>
            <p className="cl-live"><i aria-hidden="true" /><b>{live}</b> live <span>sent and still in play</span></p>
            <p className="cl-target">Target {GOAL_TOTAL} by {fmtDate(GOAL_BY)}</p>
          </div>

          <svg viewBox={`0 0 960 ${ends.length ? 500 : 430}`} className="cl-svg" role="img"
               aria-label={`${STAIRS.map((s) => `${at(s.statuses).length} ${s.label.toLowerCase()}`).join(", ")}, ${offers.length} offers. ${sent} sent, ${live} live.`}>
            <defs><filter id="cl-blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="7" /></filter></defs>
            {STAIRS.map((s, i) => <Step key={s.key} i={i} stage={s} apps={at(s.statuses)} live={SUBMITTED.some((x) => (s.statuses as readonly string[]).includes(x))} ended={ends.some((e) => e.stage.key === s.key)} />)}
            {STAIRS.map((s, i) => {
              const here = ends.filter((e) => e.stage.key === s.key);
              return here.length ? <Fallen key={s.key} x={X0 + i * DX} y={Y0 - i * DY} stage={s} ends={here} /> : null;
            })}
            <Peak apps={offers} />
          </svg>
        </ClimbStage>
      </div>
    </section>
  );
}
