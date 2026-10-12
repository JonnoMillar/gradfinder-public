/**
 * Your criteria. Edit this file, not the DB. This copy is an example: the author's own filters (a 2027-intake
 * graduate in London who wanted builder/data roles), minus anything personal. Change every list to suit you.
 * Everything in here is applied deterministically by lib/pipeline/filter.ts and lib/pipeline/rank.ts.
 */

/**
 * Functions ruled out. Matched case-insensitively as whole words against title + function tag.
 * `unlessSoftware` patterns (and the LLM's key) are skipped when the title matches SOFTWARE_TITLE_PATTERN —
 * "Engineering Graduate Programme" is civil at Savills and backend at LSEG.
 */
export const EXCLUDED_FUNCTIONS: { key: string; patterns: RegExp[]; unlessSoftware?: RegExp[] }[] = [
  { key: "sales", patterns: [/\bsales\b/i, /\bbusiness development\b/i, /\bBDR\b/, /\bSDR\b/, /\baccount executive\b/i] },
  { key: "legal", patterns: [/\blegal\b/i, /\bsolicitor\b/i, /\bparalegal\b/i, /\btraining contract\b/i, /\bpupillage\b/i, /\blaw\b/i, /\bvacation scheme\b/i] },
  { key: "recruitment", patterns: [/\brecruit(er|ment|ing)\b/i, /\btalent acquisition\b/i] },
  { key: "hr", patterns: [/\bHR\b/, /\bhuman resources\b/i, /\bpeople (team|partner|operations)\b/i] },
  { key: "marketing", patterns: [/\bmarketing\b/i, /\bmarketer\b/i, /\bbrand (manager|executive|assistant)\b/i, /\bPR\b/, /\bcommunications\b/i] },
  { key: "project_management", patterns: [/\bproject manag(er|ement)\b/i, /\bPMO\b/, /\bprogramme manag(er|ement)\b/i] },
  { key: "accounting", patterns: [/\baccount(ant|ing|ancy)\b/i, /\bACA\b/, /\bACCA\b/, /\bCIMA\b/, /\bbookkeep/i] },
  { key: "audit", patterns: [/\baudit(or|ing)?\b/i, /\bassurance\b/i] },
  { key: "tax", patterns: [/\btax\b/i, /\bATT\b/, /\bCTA\b/] },
  { key: "compliance", patterns: [/\bcompliance\b/i, /\bAML\b/, /\bKYC\b/, /\bfinancial crime\b/i] },
  // 2026-09-23, Jonno: software/ML/quant/tech schemes stay; physical engineering does not. The LLM's
  // `engineering` key already means non-software (software_engineering is its own key), and the title
  // patterns catch rows extracted before that distinction or never extracted. "Software Engineering
  // Graduate Programme" must not match, hence the lookbehind.
  { key: "engineering", patterns: [
    // qualifier directly before "engineer": "Site Reliability Engineer" and "Electronic Trading Engineer" are
    // software/quant roles and must survive, so no gap is allowed (only "Electrical/Controls Engineer" style pairs)
    // …except "design": "Electrical Design Engineer" is still electrical
    /\b(civil|structural|mechanical|electrical|geotechnical|chemical|manufacturing|aerospace|nuclear|building services|highways?|site|control systems?)( ?(and|&|\/) ?\w+)?( design)? engineer(ing|s)?\b/i,
    /\bhydrolog/i, /\bgeotechnic/i, /\btechnician\b/i, /\btemporary works\b/i,
  ], unlessSoftware: [
    /(?<!(software|data|ml|ai|platform|security|machine learning|reliability|quant|cloud|devops|product|technology)\s)\bengineering (graduate|programme|scheme|trainee)\b/i,
  ] },
  { key: "environment", patterns: [
    /\benvironment(al)?\b/i, /\becolog(y|ist|ical)\b/i, /\bsustainab(le|ility)\b/i,
    /\barboricultur/i, /\bcontaminated land\b/i, /\bland quality\b/i,
  ] },
  // 2026-09-23, Jonno: surveying, property and town planning go. Narrow on purpose: "Wealth Planning", a
  // "Quantitative Valuation Analyst" and real-estate *investing* (Blackstone REAM, RE investment banking) stay.
  { key: "property", patterns: [
    /\bsurvey(or|ors|ing)\b/i,
    /(?<!intellectual\s)\bproperty\b(?!\s*(&|and)\s*casualty)/i,
    /^(?!.*\b(asset management|investment|investing|capital markets|private equity|debt|credit|banking)\b).*\breal estate\b/i,
    // same qualifier guard on both: "Financial Planning Graduate", "Supply Chain Planning Graduate Programme"
    /\b(town|urban|spatial) planning\b/i,
    /(?<!(financial|wealth|demand|supply|chain|media|workforce|capacity|business|sales|tax)\s)\bplanning (graduate|programme|economics|consultan\w*|(&|and) development)\b/i,
    /[-–]\s*planning\s*$/i, /(?<!(financial|wealth|demand|supply|chain|media|workforce|capacity|business|sales|tax)\s)\bplanners?\b/i,
    /\baffordable housing\b/i, /\bhousing (management|officer|association)\b/i, /\brural\b/i, /\blandscape architect/i,
  ] },
  // school vacancies Indeed returns for "graduate" queries (need QTS; not graduate schemes). Teach First's
  // "Training Programme" titles don't say "Teacher of", so they are unaffected.
  { key: "teaching", patterns: [/\bteacher of\b/i, /\b(teaching|learning support) assistant\b/i] },
  { key: "water", patterns: [/\bwater (recycling|operations|treatment|network|resources|quality)\b/i, /\bwastewater\b/i, /\breservoirs?\b/i] },
  // "id still consider roles like Market, Credit, or Quantitative Risk" — so only these two go, not "risk"
  { key: "actuarial", patterns: [/\bactuar(y|ies|ial)\b/i, /\bpensions? governance\b/i] },
  { key: "risk_advisory", patterns: [/\brisk (advisory|assurance|consulting)\b/i, /\brisk (&|and) advisory\b/i, /\binternal controls?\b/i, /\bgovernance,? risk\b/i] },
];

/**
 * The LLM sometimes files software roles under `engineering` (LSEG "Engineering Graduate Programme (Backend)",
 * OpenAI "Network Engineer", Maven "Graduate Infrastructure Engineer"). A title matching this overrides that
 * key alone; an explicit physical-engineering title pattern above still wins.
 */
export const SOFTWARE_TITLE_PATTERN = /\b(software|back-?end|front-?end|full-?stack|infrastructure|platform|network|security|linux|devops|cloud|data|machine learning|ML|AI|site reliability|SRE|developer|automation engineer|design engineer, brand)\b/i;

/** Postings that aren't jobs at all. Excluded before anything else. */
export const EXCLUDED_KINDS_PATTERNS: RegExp[] = [
  /\bapprenticeship\b/i, /\bschool leaver\b/i, /\bdegree apprentice/i, /\bpostgraduate (course|study)\b/i,
  /\bMBA\b/, /\bmasters? (in|of)\b/i, /\bPhD\b/i, /\bbursary\b/i, /\bscholarship\b/i,
  // 2026-09-23, Jonno: no internships, placements, insight programmes or events — only the job itself
  /\bintern(ship)?s?\b/i, /\bplacements?\b/i, /\binsight (day|days|week|programme|program|event|evening)s?\b/i,
  /\bspring (week|insight|programme)\b/i, /\b(work|school|virtual) experience\b/i, /\bopen (day|evening)\b/i,
  /\bnetworking event\b/i, /\bwebinar\b/i, /\bimmersion\b/i, /\bdiscover(y)? (day|your)\b/i,
];

/** Job kinds (source- or LLM-classified) that are never wanted. Same intent as the patterns above. */
export const EXCLUDED_JOB_KINDS = ["internship", "placement", "insight"] as const;

/**
 * A title that names the full-time job outranks an internship/insight kind label. Coverage audit 2026-09-23: the
 * LLM filed Bank of America "Software Engineer Full Time 2027 Analyst" and Investment20/20 "Global Credit Trainee"
 * as internships. Deliberately narrow — bare "graduate" is not enough: Q5 "Research Analysts - GRADUATES ONLY" is
 * a 12-week internship, and Jane Street / Brevan Howard intern postings carry no title marker at all.
 */
export const FULL_TIME_TITLE_PATTERN = /\b(full[- ]time|trainee|graduate (programme|program|scheme|analyst|economist|associate))\b/i;

/** "Graduate Economist & Summer Internship Programme": the internship is an extra, not the job. */
export const COMBINED_INTERNSHIP_PATTERN = /\bgraduate\b.*\s(&|and)\s+(summer\s+|spring\s+)?intern(ship)?s?\b/i;

/** The intake you are applying for (graduates July 2027). Roles that show a different one are dropped. */
export const INTAKE_YEAR = 2027;

/**
 * Languages other than English. A role that requires one is dropped (AlphaSights / GLG / Third Bridge
 * post one near-identical role per language). Remove a language here if you speak it.
 */
export const REQUIRED_LANGUAGE_EXCLUSIONS = [
  "arabic", "cantonese", "chinese", "czech", "danish", "dutch", "finnish", "flemish", "french", "german",
  "greek", "hebrew", "hindi", "hungarian", "italian", "japanese", "korean", "mandarin", "nordic", "norwegian",
  "polish", "portuguese", "romanian", "russian", "scandinavian", "spanish", "swedish", "thai", "turkish", "vietnamese",
];

/** Titles that are clearly not entry-level. Applied before the LLM judges the rest from the description. */
export const SENIOR_TITLE_PATTERNS: RegExp[] = [
  /\bsenior\b/i, /\bstaff\b/i, /\bprincipal\b/i, /\blead\b/i, /\bhead of\b/i, /\bdirector\b/i, /\bmanager\b/i,
  /\bVP\b/, /\bvice president\b/i, /\bchief\b/i, /\bexecutive\b/i, /\bpartner\b/i, /\barchitect\b/i, /\bfellow\b/i,
  /\b(II|III|IV|V)\b/, /\bexperienced\b/i, /\bmid-?level\b/i,
];
/** …but these override the above (e.g. "Graduate Manager Programme" is a scheme name). */
export const SENIOR_OVERRIDE_PATTERNS: RegExp[] = [/\bgraduate\b/i, /\bgrad\b/i, /\bearly careers?\b/i, /\bentry[- ]level\b/i, /\bnew grad\b/i, /\bjunior\b/i, /\bassociate\b/i, /\banalyst\b/i, /\btrainee\b/i];

/** Location strings that count as London (or hybrid with a London office). */
export const LONDON_PATTERNS: RegExp[] = [
  /\blondon\b/i, /\bcanary wharf\b/i, /\bcity of london\b/i, /\bshoreditch\b/i, /\bking'?s cross\b/i,
  /\bcroydon\b/i, /\bstratford\b/i, /\bhammersmith\b/i, /\bpaddington\b/i,
  // outer-London boroughs seen on real postings (BofA's tech grads sit in Bromley). Not bare "Sutton"/"Richmond":
  // Sutton Coldfield and Richmond (N. Yorks) are elsewhere.
  /\bbromley\b/i, /\bkingston upon thames\b/i, /\buxbridge\b/i, /\bharrow\b/i, /\bwimbledon\b/i, /\bealing\b/i,
  /\bhounslow\b/i, /\benfield\b/i, /\brichmond upon thames\b/i, /\bheathrow\b/i, /\bgreater london\b/i,
];
/** Locations that mean "we're everywhere" and shouldn't be excluded outright. */
export const NATIONWIDE_PATTERNS: RegExp[] = [
  /\bnationwide\b/i, /\bvarious\b/i, /\bmultiple (locations|offices)\b/i, /\bUK ?wide\b/i, /\bacross the uk\b/i,
  /\bunited kingdom\b/i, /^uk$/i, /\bflexible\b/i, /\bremote\b/i,
];

/**
 * Sector weights for ranking (0–3). Unknown sector = 1. They only order roles Claude has not evaluated yet
 * (lib/pipeline/rank.ts v1); evaluated roles rank on the evaluation. Raise the sectors you want.
 */
export const SECTOR_WEIGHTS: Record<string, number> = {
  ai: 1, fintech: 1, quant: 1, deep_tech: 1, climate: 1, health: 1, defence: 1,
  big_tech: 1, consumer_tech: 1, media: 1, government: 1, energy: 1, consulting: 1, other: 1, sport: 1,
};

/**
 * Employers whose roles get the sport stamp on the list, by company name (case-insensitive). A role is also stamped
 * when its company's sector is `sport` or Claude's evaluation puts it in the `sport` family. List here the sport
 * businesses research files under another sector (Decathlon is "other"; the ATS boards below are never researched).
 */
export const SPORT_COMPANIES: string[] = [
  "Genius Sports", "Hudl", "Catapult", "Sportradar", "Decathlon",
];

/** Company career pages on public ATS APIs. Add slugs here; the sweep picks them up. */
export const ATS_WATCHLIST: { ats: "greenhouse" | "lever" | "ashby"; slug: string; name: string; sector: string }[] = [
  { ats: "greenhouse", slug: "anthropic", name: "Anthropic", sector: "ai" },
  { ats: "greenhouse", slug: "wayve", name: "Wayve", sector: "ai" },
  { ats: "greenhouse", slug: "isomorphiclabs", name: "Isomorphic Labs", sector: "ai" },
  { ats: "greenhouse", slug: "monzo", name: "Monzo", sector: "fintech" },
  { ats: "greenhouse", slug: "janestreet", name: "Jane Street", sector: "quant" },
  { ats: "greenhouse", slug: "graphcore", name: "Graphcore", sector: "deep_tech" },
  { ats: "ashby", slug: "openai", name: "OpenAI", sector: "ai" },
  { ats: "ashby", slug: "elevenlabs", name: "ElevenLabs", sector: "ai" },
  { ats: "ashby", slug: "synthesia", name: "Synthesia", sector: "ai" },
  { ats: "ashby", slug: "cohere", name: "Cohere", sector: "ai" },
  { ats: "ashby", slug: "lovable", name: "Lovable", sector: "ai" },
  { ats: "ashby", slug: "faculty", name: "Faculty", sector: "ai" },
  { ats: "lever", slug: "zopa", name: "Zopa", sector: "fintech" },
  // coverage audit 2026-09-23: employers no grad board carried. Each slug checked by hand to be the right company
  // with London roles; dropped: wise/cleo/polyai (no London roles on that board), moneybox/hrt/mistral/kraken (empty).
  { ats: "greenhouse", slug: "stripe", name: "Stripe", sector: "fintech" },
  { ats: "greenhouse", slug: "gocardless", name: "GoCardless", sector: "fintech" },
  { ats: "greenhouse", slug: "jumptrading", name: "Jump Trading", sector: "quant" },
  { ats: "greenhouse", slug: "squarepointcapital", name: "Squarepoint Capital", sector: "quant" },
  { ats: "greenhouse", slug: "quberesearchandtechnologies", name: "Qube Research & Technologies", sector: "quant" },
  { ats: "greenhouse", slug: "xtxmarketstechnologies", name: "XTX Markets", sector: "quant" },
  { ats: "greenhouse", slug: "flowtraders", name: "Flow Traders", sector: "quant" },
  { ats: "greenhouse", slug: "databricks", name: "Databricks", sector: "ai" },
  { ats: "greenhouse", slug: "scaleai", name: "Scale AI", sector: "ai" },
  { ats: "greenhouse", slug: "deliveroo", name: "Deliveroo", sector: "consumer_tech" },
  { ats: "ashby", slug: "plaid", name: "Plaid", sector: "fintech" },
  { ats: "ashby", slug: "oaknorth", name: "OakNorth", sector: "fintech" },
  { ats: "ashby", slug: "marshmallow", name: "Marshmallow", sector: "fintech" },
  { ats: "ashby", slug: "quantexa", name: "Quantexa", sector: "ai" },
  { ats: "ashby", slug: "tractable", name: "Tractable", sector: "ai" },
  { ats: "ashby", slug: "trainline", name: "Trainline", sector: "consumer_tech" },
  { ats: "lever", slug: "palantir", name: "Palantir", sector: "big_tech" },
  { ats: "lever", slug: "spotify", name: "Spotify", sector: "consumer_tech" },
  // sport (Jonno 2026-09-24: "sport is a big positive, especially football"). Boards probed 2026-09-24: London roles
  // exist but are mostly senior today; the filter drops those, and grad/junior roles surface on later sweeps.
  { ats: "greenhouse", slug: "geniussports", name: "Genius Sports", sector: "sport" },
  { ats: "greenhouse", slug: "hudl", name: "Hudl", sector: "sport" },
  { ats: "greenhouse", slug: "catapultsports", name: "Catapult", sector: "sport" },
  { ats: "greenhouse", slug: "sportradar", name: "Sportradar", sector: "sport" },
];

/** Known reposters/aggregators that appear as the "company" on LinkedIn/Indeed. */
export const REPOSTER_NAMES = ["targetjobs uk", "targetjobs", "gradcracker", "bright network", "milkround", "higherin", "ratemyplacement"];

export const RESEARCH_TTL_DAYS = 7;

/**
 * Same employer, two trading names — `companySlug` can't see it and guessing is worse than not guessing
 * ("Octopus Energy" and "Octopus Investments" are genuinely different employers, so stripping a word like
 * "Energy" would merge the wrong rows). Maps the slug a name would otherwise get → the slug to use instead.
 * Add a pair here when you spot a duplicate on /companies; re-running a sweep re-homes the jobs.
 */
export const COMPANY_SLUG_ALIASES: Record<string, string> = {
  "edf-energy": "edf",   // "EDF Energy" (Higherin) and "EDF UK" (TARGETjobs) are one employer
};

/**
 * Stations you commute from. The role page shows a TfL journey time from each to the role's office, Monday 08:30.
 * `stop` is a TfL StopPoint id (api.tfl.gov.uk/StopPoint/Search/<name>). Empty = no journey times.
 * Example: [{ name: "Brixton", stop: "940GZZLUBXN" }, { name: "Stratford", stop: "940GZZLUSTD" }]
 */
export const COMMUTE_FROM: { name: string; stop: string }[] = [];
