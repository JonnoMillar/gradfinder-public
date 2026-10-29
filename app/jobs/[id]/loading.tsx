/** A role page while it renders: the crumb, the hero (logo, title, stage track, key facts), the contents bar, sections. */
import { Sk, SkPage, SkRow } from "@/components/Skeleton";

const section = (h: number) => <div className="sk-sec"><Sk h={22} w={200} /><Sk h={h} r={14} /></div>;

export default function Loading() {
  return (
    <SkPage label="role" className="ff">
      <Sk h={14} w={200} style={{ marginBottom: 16 }} />
      <div className="ffh">
        <Sk h={52} w={52} r={12} />
        <div className="sk-stack" style={{ flex: 1 }}><Sk h={34} w="70%" /><Sk h={16} w="40%" /></div>
      </div>
      <div className="sk-stack" style={{ marginTop: 20 }}>
        <Sk h={44} r={99} /><Sk h={46} /><Sk h={94} r={14} /><SkRow n={4} h={82} />
      </div>
      <Sk h={42} r={99} style={{ marginTop: 18 }} />
      {section(180)}
      {section(200)}
      {section(120)}
    </SkPage>
  );
}
