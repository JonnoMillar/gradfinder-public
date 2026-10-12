"use client";
/**
 * Draws page 1 of a PDF with pdf.js at the card's real pixel width (devicePixelRatio included), and redraws when the
 * card settles at a new width. While the Kit page grows or shrinks the card, CSS just scales the last bitmap, so the
 * animation never waits on pdf.js; the sharp redraw lands a moment after it stops. Each draw gets a fresh canvas that
 * replaces the old one when done: pdf.js may hand a canvas to its worker, after which it can't be resized or read.
 */
import { useEffect, useRef, useState } from "react";
import type { PDFPageProxy, RenderTask } from "pdfjs-dist";

export function PdfSheet({ src, label }: { src: string; label: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let page: PDFPageProxy | null = null;
    let task: RenderTask | null = null;
    let drawn = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    const draw = async () => {
      const width = Math.round(el.getBoundingClientRect().width * window.devicePixelRatio); // on-screen px: the app is zoomed
      if (!page || !width || Math.abs(width - drawn) < 4) return;
      task?.cancel();
      const viewport = page.getViewport({ scale: width / page.getViewport({ scale: 1 }).width });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", label);
      task = page.render({ canvas, viewport });
      try { await task.promise; } catch { return; } // cancelled by a newer draw
      if (cancelled) return;
      el.querySelector("canvas")?.replaceWith(canvas) ?? el.prepend(canvas);
      drawn = width;
      setState("ready");
    };

    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
        const doc = await pdfjs.getDocument({ url: src }).promise;
        page = await doc.getPage(1);
        if (!cancelled) await draw();
      } catch {
        if (!cancelled) setState("error");
      }
    })();

    const ro = new ResizeObserver(() => { clearTimeout(timer); timer = setTimeout(draw, 180); });
    ro.observe(el);
    return () => { cancelled = true; ro.disconnect(); clearTimeout(timer); task?.cancel(); };
  }, [src, label]);

  return (
    <div ref={box} className="kx-sheet" data-state={state}>
      {state === "error" ? <p className="kx-sheet-err">Couldn&apos;t draw the preview. Use View CV instead.</p> : null}
    </div>
  );
}
