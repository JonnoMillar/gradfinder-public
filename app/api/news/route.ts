/**
 * How many Gmail stage moves are still unseen, for the nav to check when the tab comes back into view. The Gmail sync
 * runs in the background and a client navigation never re-renders the layout, so an open tab would otherwise wait for a
 * reload to show the badge. Read only.
 */
import { unseenMoves } from "@/lib/queries";

export const dynamic = "force-dynamic";

export function GET() {
  const moves = unseenMoves();
  const ended = moves.filter((m) => m.to === "rejected").length;
  return Response.json({ forward: moves.length - ended, ended });
}
