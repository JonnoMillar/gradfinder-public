"use client";

/** Ticks off an action that came from a recruiter email. Errors are shown, never swallowed. */
import { useState, useTransition } from "react";
import { setEmailActionDone } from "@/app/actions";

export function ActionDoneButton({ id, done }: { id: number; done: boolean }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  return (
    <>
      <button
        type="button" className="st" disabled={pending}
        onClick={() => start(async () => {
          setErr(null);
          const r = await setEmailActionDone({ id, done: !done });
          if (!r.ok) setErr(r.error);
        })}
      >
        {pending ? "…" : done ? "Reopen" : "Done"}
      </button>
      {err ? <span className="tmsg" data-err="1" role="status">{err}</span> : null}
    </>
  );
}
