import { Sk, SkPage } from "@/components/Skeleton";

export default function Loading() {
  return (
    <SkPage label="company" className="ff">
      <Sk h={14} w={160} style={{ marginBottom: 16 }} />
      <div className="ffh">
        <Sk h={52} w={52} r={12} />
        <div className="sk-stack" style={{ flex: 1 }}><Sk h={34} w={300} /><Sk h={16} w={180} /></div>
      </div>
      <div className="sk-sec"><Sk h={14} w={140} /><Sk h={14} w="64%" /><Sk h={14} w="58%" /></div>
      <div className="sk-sec">
        <Sk h={14} w={140} />
        <div className="tiles">{Array.from({ length: 6 }, (_, i) => <Sk key={i} h={200} />)}</div>
      </div>
    </SkPage>
  );
}
