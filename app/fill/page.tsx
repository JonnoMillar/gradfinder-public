/** `/fill` — start the Playwright apply run for any form URL, even one with no role in the database. */
import { PageSlide } from "@/components/PageSlide";
import { fillFormAction } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function FillPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const field = { display: "grid", gap: 4, marginBottom: 14 } as const;
  return (
    <PageSlide>
      <main className="wrap ff">
        <div className="lead" style={{ padding: "8px 0 0" }}>
          <h1>Fill a form</h1>
          <p className="sub">
            Paste any application form. Claude fills it in the run browser from your knowledge store, asks for the gaps,
            and stops before Submit. It appears as a role here so you can follow it.
          </p>
        </div>
        {error ? <p role="alert"><b>Not started:</b> {error}</p> : null}
        <form action={fillFormAction} style={{ maxWidth: 560 }}>
          <label style={field}>Form URL
            <input className="search" name="url" type="url" required placeholder="https://…" />
          </label>
          <label style={field}>Company
            <input className="search" name="company" required />
          </label>
          <label style={field}>Role title
            <input className="search" name="title" required />
          </label>
          <button className="btn btn--go">Start the fill</button>
        </form>
      </main>
    </PageSlide>
  );
}
