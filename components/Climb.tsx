/**
 * The climb (Jonno 2026-10-02): the whole pipeline as a staircase of floating cubes rising to the grad offer, so the
 * numbers build into something you can see rather than sitting in cards.
 *
 *  - One cube per stage, left to right and rising: Interested → Applying → Sent → Tests → HireVue → Interview. The
 *    stage's icon is engraved on its right face and its count on its left face. A stage with nobody on it is a faint
 *    ghost, so the stairs light up as roles move along.
 *  - The summit is the Offer: a bigger gold cube with the flag on it and a halo behind, gold even when empty, because
 *    it is the point of the whole climb (Jonno: "more aspirational").
 *  - On top of each cube sits a pile of small cubes, one per role at that stage (hover for the company, click to open
 *    it). Three by three a layer, so twenty applications read as piles, not a table.
 *  - Live applications (sent and still in play) glow: a mint light under each live stage that has roles, and the count
 *    beside the headline. The headline itself is the total sent (a rejection still counts as one made); the 40 target
 *    is one quiet line (Jonno: "I don't really care about it that much").
 *  - Rejected, closed and binned roles are "off the stairs", a quiet line linking to the archive.
 *
 * Pure SVG from the server, plus CSS: the cubes rise in sequence, the small ones drop onto them, the lights come up.
 * All of it is off under reduced motion. A fixed 960×430 drawing; below ~800px it scrolls sideways rather than shrinking.
 */
import type { ApplicationRow } from "@/lib/queries";
import { GOAL_BY, GOAL_TOTAL } from "@/lib/tracker/goals";
import { SUBMITTED } from "@/lib/tracker/attention";
import { fmtDate } from "@/lib/ui/format";

// ------------------------------------------------------------------------------------------- geometry
const T30 = Math.tan(Math.PI / 6);
type Cube = { a: number; h: number; H: number };
/** an isometric cube: `a` = half its width; the top face is 2h tall and the sides H tall */
const cube = (a: number): Cube => ({ a, h: a * T30, H: (2 * a) / Math.sqrt(3) });
const STEP = cube(42);
const MINI = cube(9.5);
const PEAK = cube(62);
const X0 = 70, DX = 114, Y0 = 290, DY = 28;
const PEAK_X = 826;
const r1 = (n: number) => Math.round(n * 10) / 10;
const pts = (p: number[][]) => p.map(([px, py]) => `${r1(px)},${r1(py)}`).join(" ");

/** the three visible faces of a cube whose top vertex is at (x, y), plus the skews that map local (0..a, 0..H) onto the sides */
function faces(x: number, y: number, { a, h, H }: Cube) {
  const k = r1(T30 * 1000) / 1000;
  return {
    top: pts([[x, y], [x + a, y + h], [x, y + 2 * h], [x - a, y + h]]),
    left: pts([[x - a, y + h], [x, y + 2 * h], [x, y + 2 * h + H], [x - a, y + h + H]]),
    right: pts([[x, y + 2 * h], [x + a, y + h], [x + a, y + h + H], [x, y + 2 * h + H]]),
    /** the cube's footprint dropped below it: where its light falls */
    floor: pts([[x, y + H + 14], [x + a, y + h + H + 14], [x, y + 2 * h + H + 14], [x - a, y + h + H + 14]]),
    leftT: `matrix(1 ${k} 0 1 ${r1(x - a)} ${r1(y + h)})`,
    rightT: `matrix(1 ${-k} 0 1 ${r1(x)} ${r1(y + 2 * h)})`,
  };
}

// ------------------------------------------------------------------------------------------- stages
/** 16-unit stroked paths, same grid as lib/ui/icons.tsx */
const ICON: Record<string, readonly string[]> = {
  interested: ["M4.5 2h7v12l-3.5-2.6L4.5 14z"],
  applying: ["M10.6 2.4 13.6 5.4 6 13H3v-3z", "M9.1 3.9l3 3"],
  applied: ["M14 2 2 7l5 2 2 5z", "M14 2 7 9"],
  tests: ["M3 2.5h10v11.5H3z", "M6 1.5h4v2H6z", "m5.8 8.6 1.4 1.4 3-3.2"],
  hirevue: ["M1.5 4h9.5v8H1.5z", "m11 8 3.5-2.2v4.4z"],
  interview: ["M5.5 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4z", "M1.5 13.5c0-2.2 1.8-4 4-4s4 1.8 4 4", "M11 7.3a1.7 1.7 0 1 0 0-3.4", "M12 9.3c1.5.4 2.6 1.9 2.6 4.2"],
  offer: ["M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z"],
};

const STAIRS = [
  { key: "interested", label: "Interested", statuses: ["interested"] },
  { key: "applying", label: "Applying", statuses: ["applying"] },
  { key: "applied", label: "Sent", statuses: ["applied"] },
  { key: "tests", label: "Tests", statuses: ["tests", "tests_done"] },
  { key: "hirevue", label: "HireVue", statuses: ["hirevue", "hirevue_done"] },
  { key: "interview", label: "Interview", statuses: ["interview", "interview_done"] },
] as const;

/** the first layer fills from the middle out, so a few roles look like a heap and not a row */
const CELLS = [[1, 1], [0, 1], [1, 0], [2, 1], [1, 2], [0, 0], [2, 2], [0, 2], [2, 0]] as const;
/** on the summit the back cell holds the flag */
const PEAK_CELLS = CELLS.filter(([u, v]) => u + v > 0);

function Mini({ x, y, app, i, j }: { x: number; y: number; app: ApplicationRow; i: number; j: number }) {
  const f = faces(x, y, MINI);
  return (
    <a href={`/jobs/${app.jobId}`} className="cl-mini" style={{ ["--i" as string]: i, ["--j" as string]: j }}>
      <title>{`${app.company}: ${app.title}`}</title>
      <polygon points={f.left} className="cl-l" />
      <polygon points={f.right} className="cl-r" />
      <polygon points={f.top} className="cl-t" />
    </a>
  );
}

/** the roles at a stage as small cubes piled on its top face, back to front within a layer, layer on layer */
function Pile({ x, y, c, apps, i, cells = CELLS, layers = 3 }: {
  x: number; y: number; c: Cube; apps: ApplicationRow[]; i: number; cells?: readonly (readonly [number, number])[]; layers?: number;
}) {
  const per = cells.length;
  const minis = apps.slice(0, per * layers).map((app, n) => {
    const layer = Math.floor(n / per);
    const [u, v] = cells[n % per];
    const cx = x + ((u + 0.5) / 3) * c.a - ((v + 0.5) / 3) * c.a;
    const cy = y + ((u + 0.5) / 3) * c.h + ((v + 0.5) / 3) * c.h - layer * MINI.H;
    return { app, layer, depth: u + v, x: cx, y: cy - MINI.h - MINI.H, n };
  }).sort((p, q) => p.layer - q.layer || p.depth - q.depth);
  const extra = apps.length - minis.length;
  return (
    <>
      {minis.map((m) => <Mini key={m.app.id} x={m.x} y={m.y} app={m.app} i={i} j={m.n} />)}
      {extra > 0 ? <text x={x + c.a + 4} y={y - 2 * MINI.H} className="cl-more">+{extra}</text> : null}
    </>
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

function Step({ i, stage, apps, live }: { i: number; stage: (typeof STAIRS)[number]; apps: ApplicationRow[]; live: boolean }) {
  const x = X0 + i * DX, y = Y0 - i * DY;
  const f = faces(x, y, STEP);
  const { h, H } = STEP;
  // a stage with a ticked half (tests_done, hirevue_done, interview_done): how many are still to do and how many done
  const done = apps.filter((p) => p.status !== stage.key).length;
  const sub = stage.statuses.length > 1 && apps.length
    ? `${apps.length - done} to ${stage.key === "tests" ? "sit" : "do"} · ${done} ${stage.key === "tests" ? "sat" : "done"}`
    : null;
  return (
    <g className="cl-step" data-s={stage.key} data-empty={apps.length ? undefined : "1"} style={{ ["--i" as string]: i }}>
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
  // its base sits where a seventh step's would
  const y = Y0 - 6 * DY + (2 * STEP.h + STEP.H) - (2 * h + H);
  const f = faces(x, y, PEAK);
  const poleX = x, poleY = y + h * 0.62;
  return (
    <g className="cl-peak" data-s="offer" data-empty={apps.length ? undefined : "1"} style={{ ["--i" as string]: 6 }}>
      <title>{`Offer: ${apps.length}. The grad job.`}</title>
      <circle cx={x} cy={y + h + H / 2} r={a * 1.9} className="cl-halo" />
      {apps.length ? <polygon points={f.floor} className="cl-glow" filter="url(#cl-blur)" /> : null}
      <polygon points={f.left} className="cl-l" />
      <polygon points={f.right} className="cl-r" />
      <polygon points={f.top} className="cl-t" />
      <Engraving f={f} c={PEAK} n={apps.length} icon="offer" />
      <line x1={poleX} x2={poleX} y1={poleY} y2={poleY - 70} className="cl-pole" />
      <path d={`M${poleX} ${r1(poleY - 70)} h32 l-8 9.5 8 9.5 h-32 z`} className="cl-flag" />
      <Pile x={x} y={y} c={PEAK} apps={apps} i={6} cells={PEAK_CELLS} layers={1} />
      <text x={x} y={y + 2 * h + H + 26} className="cl-lab cl-lab--peak" textAnchor="middle">Offer</text>
      <text x={x} y={y + 2 * h + H + 43} className="cl-sub" textAnchor="middle">the grad job</text>
    </g>
  );
}

export function Climb({ apps }: { apps: ApplicationRow[] }) {
  const at = (statuses: readonly string[]) => apps.filter((a) => statuses.includes(a.status));
  const sent = apps.filter((a) => a.appliedAt || SUBMITTED.includes(a.status)).length;
  const live = at(SUBMITTED).length;
  const off = [
    [at(["rejected"]).length, "rejected"], [at(["closed"]).length, "closed"], [at(["dismissed"]).length, "binned"],
  ].filter(([n]) => n) as [number, string][];
  const offers = at(["offer"]);

  return (
    <section className="cl" aria-labelledby="cl-h">
      <div className="cl-scroll">
        <div className="cl-stage">
          <div className="cl-head">
            <h2 id="cl-h" className="cl-eye">The climb</h2>
            <p className="cl-big"><b>{sent}</b><span>application{sent === 1 ? "" : "s"} sent</span></p>
            <p className="cl-live"><i aria-hidden="true" /><b>{live}</b> live <span>sent and still in play</span></p>
            <p className="cl-target">Target {GOAL_TOTAL} by {fmtDate(GOAL_BY)}</p>
          </div>

          <svg viewBox="0 0 960 430" className="cl-svg" role="img"
               aria-label={`${STAIRS.map((s) => `${at(s.statuses).length} ${s.label.toLowerCase()}`).join(", ")}, ${offers.length} offers. ${sent} sent, ${live} live.`}>
            <defs><filter id="cl-blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="7" /></filter></defs>
            {STAIRS.map((s, i) => <Step key={s.key} i={i} stage={s} apps={at(s.statuses)} live={SUBMITTED.some((x) => (s.statuses as readonly string[]).includes(x))} />)}
            <Peak apps={offers} />
          </svg>

          {off.length ? (
            <p className="cl-foot">
              Off the stairs: <a href="#archive">{off.map(([n, w]) => `${n} ${w}`).join(", ")}</a>
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
