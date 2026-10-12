/**
 * Serves a CV PDF from the gitignored profile/cv/ to the Kit page's preview. Only a bare `*.pdf` file name that exists
 * in that folder is served: no paths, so nothing else on disk is reachable. The server binds to 127.0.0.1 (no auth).
 */
import fs from "node:fs";
import path from "node:path";
import { CURRENT_CV, CV_DIR } from "@/lib/kit";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const name = new URL(request.url).searchParams.get("f") ?? CURRENT_CV;
  if (name !== path.basename(name) || !/^[\w .()-]+\.pdf$/i.test(name)) return new Response("Bad file name", { status: 400 });
  const file = path.join(CV_DIR(), name);
  if (!fs.existsSync(file)) return new Response("Not found", { status: 404 });
  return new Response(fs.readFileSync(file), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${name}"`, "Cache-Control": "no-store" },
  });
}
