"use client";

/**
 * The Climb's frame, and the one control it has: "N rejected". Hovering (or focusing) it makes the rejected roles fall
 * from their stage onto the floor beneath it (CSS, `.cl-ghost`); a click keeps them there and a second click clears
 * them, so it works on touch too. The drawing itself stays a server render passed in as children.
 */
import { useState, type ReactNode } from "react";
import { cube, faces } from "@/lib/ui/cubes";

const icon = faces(8, 1.5, cube(5.5));

export function ClimbStage({ rejected, children }: { rejected: number; children: ReactNode }) {
  const [locked, setLocked] = useState(false);
  return (
    <div className={`cl-stage${rejected ? " cl-stage--tall" : ""}`} data-locked={locked ? "1" : undefined}>
      {children}
      {rejected ? (
        <button type="button" className="cl-endbtn" aria-pressed={locked} onClick={() => setLocked((l) => !l)}
                title="Hover to see where your rejections ended; click to keep them showing, click again to clear">
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <polygon points={icon.left} /><polygon points={icon.right} /><polygon points={icon.top} />
          </svg>
          <b>{rejected}</b> rejected
          <em>{locked ? "click to clear" : "hover to see where"}</em>
        </button>
      ) : null}
    </div>
  );
}
