/**
 * Page-to-page motion. Every page wraps its content in this, so a navigation tagged with a transition type moves
 * the page instead of cutting to it: `nav-forward` (opening a role or a company) slides the old page out to the
 * left and the new one in from the right, `nav-back` (the Roles crumb) does the reverse, `tab` (the top bar)
 * crossfades with a small rise. Untagged navigations (the browser's back button, a refresh) are not animated.
 * The header is anchored (`site-header` in globals.css), so only the content moves.
 *
 * It has to live in each page, not the layout: layouts persist across navigations, so enter and exit never fire.
 */
import { ViewTransition, type ReactNode } from "react";

const MAP = { "nav-forward": "nav-forward", "nav-back": "nav-back", tab: "tab", default: "none" };

export function PageSlide({ children }: { children: ReactNode }) {
  return (
    <ViewTransition enter={MAP} exit={MAP} default="none">
      <div className="page">{children}</div>
    </ViewTransition>
  );
}
