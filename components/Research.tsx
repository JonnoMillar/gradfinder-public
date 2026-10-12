/**
 * Section frame for the role page (lib/apply/research.ts). Server component.
 *
 * Each section has its own accent (`data-acc`, mapped to `--acc` in globals.css) and icon, so the long page reads
 * as distinct blocks. A section the research couldn't answer says what was searched instead of rendering nothing.
 */

export function Unknown({ researched, searched, beyondPosting }: { researched: boolean; searched?: string[]; beyondPosting?: boolean }) {
  if (!researched) return <p className="unk">Not researched yet{beyondPosting ? " beyond the posting" : ""}.</p>;
  return (
    <p className="unk"><b>{beyondPosting ? "Nothing more found." : "Unknown."}</b>{" "}
      {searched?.length ? <>Searched: {searched.join(" · ")}</> : "Nothing sourced was found."}</p>
  );
}

export function Section({ id, acc, icon, title, note, researched, searched, hasContent, fromPosting, children }: {
  id: string; acc: string; icon: React.ReactNode; title: string; note?: React.ReactNode;
  researched: boolean; searched?: string[];
  /** the section shows sourced content; an unknown then only lists the gaps, small */
  hasContent: boolean;
  fromPosting?: boolean; children?: React.ReactNode;
}) {
  return (
    <section id={id} className="rs" data-acc={acc}>
      <h2 className="rs-h"><span className="rs-ic" aria-hidden>{icon}</span>{title}{note ? <span className="n">{note}</span> : null}</h2>
      {children}
      {!hasContent ? <Unknown researched={researched} searched={searched} beyondPosting={fromPosting} />
        : searched?.length ? <p className="unk unk--part"><b>Not found:</b> {searched.join(" · ")}</p> : null}
    </section>
  );
}
