import { Sk, SkPage } from "@/components/Skeleton";

const lane = (rows: number) => (
  <div className="sk-sec"><Sk h={22} w={180} /><div className="sk-stack">{Array.from({ length: rows }, (_, i) => <Sk key={i} h={56} />)}</div></div>
);

export default function Loading() {
  return (
    <SkPage label="Applications" className="ff">
      <div className="sk-stack"><Sk h={48} w={280} /><Sk h={16} w={380} /></div>
      <div className="sk-sec"><Sk h={500} r={14} /><Sk h={150} r={14} /></div>
      {lane(2)}
      {lane(5)}
    </SkPage>
  );
}
