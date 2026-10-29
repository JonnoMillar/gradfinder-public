/** Roles while it renders: the hero, Apply now, the filter bar and the first tiles. Also the fallback for /fill. */
import { Sk, SkPage } from "@/components/Skeleton";

const tiles = (n: number) => <div className="tiles">{Array.from({ length: n }, (_, i) => <Sk key={i} h={200} />)}</div>;

export default function Loading() {
  return (
    <SkPage label="Roles">
      <div className="hero">
        <div className="hero-l"><Sk h={300} r={14} /><Sk h={130} r={14} /></div>
        <Sk h={444} r={14} />
      </div>
      <div className="sk-sec"><Sk h={26} w={160} /><Sk h={14} w={420} />{tiles(3)}</div>
      <div className="sk-sec"><Sk h={28} w={260} /><Sk h={14} w={220} /><Sk h={36} r={99} />{tiles(6)}</div>
    </SkPage>
  );
}
