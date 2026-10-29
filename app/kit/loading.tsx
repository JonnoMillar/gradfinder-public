import { Sk, SkPage } from "@/components/Skeleton";

export default function Loading() {
  return (
    <SkPage label="Application kit" className="ff">
      <div className="sk-stack"><Sk h={48} w={320} /><Sk h={16} w={400} /></div>
      <div className="kx-hero"><Sk h={440} r={14} /><Sk h={440} r={14} /></div>
      <div className="sk-sec"><Sk h={22} w={200} /><Sk h={36} w={360} r={99} /><Sk h={460} r={14} /></div>
    </SkPage>
  );
}
