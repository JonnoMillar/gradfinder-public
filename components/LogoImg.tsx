"use client";

/**
 * A company logo image that falls back to the company's initials when there is no real icon (2026-09-29: some sites
 * have none, and the icon service then serves a 16px grey globe, which reads as a broken logo). A failed load, or an
 * image 16px wide or less, counts as no logo. Checked after hydration too, since the image may have loaded before.
 */
import { useEffect, useRef, useState, type CSSProperties } from "react";

export function LogoImg({ src, style, text }: { src: string; style: CSSProperties; text: string }) {
  const [bad, setBad] = useState(false);
  const img = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const el = img.current;
    if (el?.complete && el.naturalWidth <= 16) setBad(true);
  }, []);
  if (bad) {
    return (
      <span aria-hidden="true" style={{ ...style, display: "grid", placeItems: "center",
        fontSize: Math.round(Number(style.width) * 0.36), fontWeight: 700, color: "var(--ink-2)" }}>
        {text}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- third-party favicons on arbitrary hosts, not bundled assets
    <img ref={img} src={src} alt="" loading="lazy" style={style}
         onLoad={(e) => { if (e.currentTarget.naturalWidth <= 16) setBad(true); }} onError={() => setBad(true)} />
  );
}
