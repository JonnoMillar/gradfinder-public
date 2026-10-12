"use client";

/**
 * The tap-in button (Up next card, and "Start" in the week plan): one click marks the role Applying (layer 3), plays
 * the "Started" stamp, and opens the role, so the next thing Jonno sees is its apply link. Errors are shown.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setStatus } from "@/app/actions";
import { emitMoved } from "./motion";

export function StartButton({ jobId, company = "", label = "Go for it", variant = "big" }: {
  jobId: number; company?: string; label?: string; variant?: "big" | "small";
}) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();
  return (
    <>
      <button
        type="button" className={variant === "big" ? "sg-go" : "plan-go"} disabled={pending}
        title="Marks it Applying and opens the role"
        onClick={() => start(async () => {
          setErr(null);
          const r = await setStatus({ jobId, status: "applying" });
          if (!r.ok) { setErr(r.error); return; }
          emitMoved({ jobId, company, from: "discovered", to: "applying" });
          document.getElementById("week-panel")?.hidePopover?.();
          router.push(`/jobs/${jobId}`, { transitionTypes: ["nav-forward"] });
        })}
      >
        {pending ? (variant === "big" ? "Opening…" : "…") : label}
        {variant === "big" ? (
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <path d="M3 8h9.5M8.5 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : null}
      </button>
      {err ? <span className="tmsg" data-err="1" role="status">{err}</span> : null}
    </>
  );
}
