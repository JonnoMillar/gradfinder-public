import { Sk, SkPage } from "@/components/Skeleton";

export default function Loading() {
  return (
    <SkPage label="Sweep runs" className="ff">
      <div className="sk-stack"><Sk h={32} w={200} /><Sk h={14} w={320} /></div>
      <div className="sk-stack" style={{ marginTop: 24 }}>{Array.from({ length: 12 }, (_, i) => <Sk key={i} h={36} r={6} />)}</div>
    </SkPage>
  );
}
