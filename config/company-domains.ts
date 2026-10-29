/**
 * Company website domains, for logos (Jonno 2026-09-29: "so many of these companies have no logo … i want that
 * fixed"). Most postings come through job boards and ATSs, so the sweep often has no company website to take a
 * domain from, and a domain is all the logo needs (lib/ui/format.ts `logoSrc` → the site's icon).
 *
 * Keyed by company slug. Every entry is checked by `npx tsx scripts/logos.ts check`: it fetches the homepage and
 * requires the company's name in the page title or site name, so a guessed domain can't put the wrong logo on a
 * company. `scripts/logos.ts apply` writes verified ones into `companies.domain` (blanks only), and the sweep fills
 * the same blanks for companies it creates later (lib/pipeline/run.ts).
 *
 * Deliberately missing: `g-mass` (the posting doesn't say which syndicate it is), `bezos` (bezos.ai now redirects to another company,
 * Gonini), `edyn` and `scale-space` (no reachable site found). Checked 2026-09-29.
 */

/** Checked by hand (curl, 2026-09-29) where the automatic check can't: Node's TLS refused, or the title is an acronym. */
export const HAND_VERIFIED = new Set(["ice.com", "relx.com", "smbcgroup.com", "argonandco.com"]);
export const COMPANY_DOMAINS: Record<string, string> = {
  "ameresco": "ameresco.com",
  "anglian-water": "anglianwater.co.uk",
  "anthropic": "anthropic.com",
  "argon-and-co": "argonandco.com",
  "axis": "axiscapital.com",
  "budweiser-brewing-and-i": "budweiserbrewinggroup.co.uk",
  "bytedance": "bytedance.com",
  "gamma-communications": "gammagroup.co",   // www.gamma.co.uk redirects here; title "Gamma Communications" (2026-10-27)
  "catapult": "catapult.com",
  "crew-clothing": "crewclothing.co.uk",
  "decathlon": "decathlon.co.uk",
  "deliveroo": "deliveroo.co.uk",
  "edf": "edfenergy.com",
  "ebury": "ebury.com",
  "elevenlabs": "elevenlabs.io",
  "elsevier": "elsevier.com",
  "erm-erm-careers": "erm.com",
  "exxonmobil": "exxonmobil.com",
  "faculty": "faculty.ai",
  "fastretailing-graduates-eu-uniqlo": "uniqlo.com",
  "flextrade": "flextrade.com",
  "franklintempleton": "franklintempleton.com",
  "genius-sports": "geniussports.com",
  "graham": "graham.co.uk",
  "graphcore": "graphcore.ai",
  "hvs": "hvs.com",
  "imc": "imc.com",
  "inpost": "inpost.co.uk",
  "intercontinental-exchange": "ice.com",
  "j-p-morgan": "jpmorgan.com",
  "jane-street": "janestreet.com",
  "jump-trading": "jumptrading.com",
  "kearney": "kearney.com",
  "kisaco-research": "kisacoresearch.com",
  "kroll": "kroll.com",
  "lancia-consult-pte": "lanciaconsult.com",
  "lseg": "lseg.com",
  "macquarie": "macquarie.com",
  "marsh-france": "marsh.com",
  "marshmallow": "marshmallow.com",
  "maven": "mavensecurities.com",
  "monzo": "monzo.com",
  "ncc": "nccgroup.com",
  "nestle": "nestle.co.uk",
  "oaknorth": "oaknorth.co.uk",
  "oliver-wyman": "oliverwyman.com",
  "optiver": "optiver.com",
  "palantir": "palantir.com",
  "qube-research-and": "qube-rt.com",
  "rathbones": "rathbones.com",
  "relx": "relx.com",
  "smbc": "smbcgroup.com",
  "scale-ai": "scale.com",
  "squarepoint-capital": "squarepoint-capital.com",
  "stripe": "stripe.com",
  "the-dorchester": "dorchestercollection.com",
  "the7stars-and-bountiful-cow": "the7stars.co.uk",
  "trainline": "thetrainline.com",
  "uniqlo": "uniqlo.com",
  "wsp": "wsp.com",
  "xtx-markets": "xtxmarkets.com",
  "xapien": "xapien.com",
  "zurich-insurance": "zurich.co.uk",
};
