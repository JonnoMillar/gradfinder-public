/**
 * The demo user (docs/superpowers/specs/2026-10-12-public-showcase.md): Alex Morgan, a fictional graduate, on real
 * public postings at recognisable companies. Everything personal here is made up: the evaluations are Claude's read
 * (Opus 5.5, 2026-10-12) of each real posting against Alex's preferences, and the tracker is a believable mid-October.
 * Dates are days from the seed day (`npm run demo:seed`), so the demo never goes stale.
 *
 * Job ids are the ids in `demo/catalogue.json` (exported once from the author's database by `scripts/demo-export.ts`).
 * None of Jonno's real applications are used here.
 */
import type { ApplicationStatus, EmailKind } from "@/lib/db/schema";

export const PERSONA = {
  name: "Alex Morgan",
  summary: "Final-year BSc Economics, University of Bristol, predicted 2:1. Python, SQL, Excel, Tableau. Summer analyst " +
    "internship at a regional insurer. Wants data and analytics, or consulting with a technical edge, in London; likes " +
    "structured graduate schemes with real training; not keen on investment-banking hours or pure software engineering.",
};

/** [workFit, chance, companyType, careerPath, sector, pay|null], each 1–5. */
type S = [number, number, number, number, number, number | null];
interface Eval { id: number; s: S; r: [string, string, string, string, string, string]; stretch?: string; grad?: "yes" | "unsure" }

const NO_PAY = "No pay stated in the posting.";
const RYI = "Register-interest page: no live application yet.";

export const EVALUATIONS: Eval[] = [
  // ---- consulting and tech consulting
  { id: 263, s: [5, 4, 4, 4, 4, null], r: ["Data & AI consulting is exactly the analytics-with-clients work Alex wants.", "Large intake, and Alex's Python/SQL and internship clear the bar.", "Big structured graduate programme with formal training.", "Strong exits into data roles in industry or a senior consulting track.", "AI and data are the sectors Alex ranked first.", NO_PAY] },
  { id: 261, s: [4, 4, 4, 4, 3, null], r: ["General consulting: client problem-solving, less hands-on data than Alex would like.", "Very large intake; a 2:1 in Economics fits the profile.", "Big structured programme.", "Classic consulting ladder with broad exits.", "Sector depends on the client mix.", NO_PAY] },
  { id: 246, s: [4, 3, 4, 5, 3, null], r: ["Consulting with plenty of analysis; data depth depends on the team.", "Competitive, but Deloitte's intake is among the largest in the UK.", "Big Four with structured training.", "Best-in-class career path and brand for a consulting start.", "Sector varies by client.", NO_PAY] },
  { id: 256, s: [5, 3, 4, 4, 4, null], r: ["Data and digital consulting: SQL, dashboards and client delivery.", "Technical stream; Alex's Python/SQL helps, but there is no CS degree.", "Big Four, structured programme.", "Good track into data leadership or tech consulting.", "Data and digital sit near the top of Alex's list.", NO_PAY] },
  { id: 343, s: [4, 4, 4, 4, 3, null], r: ["Business consulting with analytics on projects.", "Large intake and a 2:1 fits.", "Big Four, structured.", "Solid consulting ladder.", "Sector varies.", NO_PAY] },
  { id: 1730, s: [4, 3, 4, 4, 3, null], r: ["Advisory and consulting: client analysis, some data work.", "Competitive scheme; Alex's internship is relevant.", "Big Four with professional training.", "Strong ladder and exits.", "Sector varies by client.", NO_PAY] },
  { id: 1944, s: [4, 2, 4, 5, 3, null], r: ["Strategy work is analytical and close to economics.", "Strategy streams take few graduates and favour top grades.", "Big Four strategy arm.", "Excellent route into strategy and corporate development.", "Sector varies.", NO_PAY], stretch: "Small intake; a strong case study and commercial-awareness answers would matter more than the CV." },
  { id: 3314, s: [5, 3, 4, 5, 5, null], r: ["Deployment Strategist: client problems solved with data and software, the mix Alex wants most.", "Selective, but the role is built for analytical non-engineers.", "Product company with a strong graduate reputation.", "Fast responsibility; exits into product and strategy.", "Data and AI platform, Alex's top sector.", NO_PAY] },
  { id: 3315, s: [4, 3, 4, 5, 4, null], r: ["Same role on UK government work: data-led problem solving.", "Selective; security clearance needed.", "Product company with strong graduate reputation.", "Fast responsibility and strong exits.", "Public-sector data work.", NO_PAY] },
  { id: 3250, s: [5, 3, 4, 4, 5, null], r: ["Associate at an applied-AI consultancy: data science with clients.", "Small intake that leans technical.", "Well-known UK AI scale-up.", "Good grounding in applied AI.", "AI is Alex's top sector.", NO_PAY], stretch: "Expects more Python than a typical economics degree teaches; one project on GitHub would help." },
  { id: 278, s: [5, 3, 4, 4, 5, null], r: ["Consulting & Analytics: payments data for clients, a near-perfect fit.", "Competitive, but analytics-friendly.", "Global brand, structured programme.", "Good path in payments and analytics.", "Fintech and payments ranked highly.", RYI] },
  // ---- data and analytics
  { id: 279, s: [5, 3, 4, 4, 5, null], r: ["Data science on payments data.", "Leans technical; Alex's Python and statistics fit.", "Global brand.", "Strong data career path.", "Fintech and payments ranked highly.", RYI] },
  { id: 1933, s: [5, 4, 4, 4, 4, 4], r: ["Data science and AI scheme: modelling and analytics on real banking problems.", "Big intake; Python/SQL plus econometrics fits well.", "UK's largest retail bank, structured scheme.", "Rotations then a data science track.", "Data and AI in financial services.", "£48,500 stated, above the market for grad data roles."] },
  { id: 1919, s: [4, 4, 4, 4, 3, 4], r: ["Risk analytics: modelling and reporting, close to an economics skill set.", "Large intake; economics graduates are a common hire.", "Big structured scheme.", "Clear path in risk and finance.", "Banking.", "£42,000 stated."] },
  { id: 1959, s: [5, 4, 4, 4, 4, null], r: ["Business analyst: requirements, data and delivery on market-data products.", "Analyst programme open to any degree.", "Exchange group with structured graduate programme.", "Good route into product or data.", "Fintech and market data.", NO_PAY] },
  { id: 237, s: [4, 4, 3, 3, 3, null], r: ["Data and digital at the regulator: analysis with public impact.", "Regulator schemes value economics graduates.", "Public body; steadier pace.", "Good, if slower, progression.", "Financial regulation.", RYI] },
  { id: 194, s: [4, 3, 4, 4, 3, null], r: ["Technology management with data and analytics rotations.", "Competitive FMCG scheme.", "Global brand, renowned graduate scheme.", "Strong leadership track.", "Consumer goods.", RYI] },
  { id: 3309, s: [4, 2, 4, 4, 4, null], r: ["Junior ML engineering: Alex likes the data side, less so production code.", "Engineering role; Alex has no CS degree.", "Product scale-up.", "Good ML engineering path.", "Consumer tech with AI.", NO_PAY], stretch: "Needs production Python and some ML ops; a stretch from an economics degree." },
  { id: 597, s: [3, 2, 4, 4, 4, null], r: ["Data engineering: pipelines more than analysis.", "Very selective, and engineering-heavy.", "Top trading firm.", "Strong technical growth.", "Trading.", NO_PAY] },
  // ---- finance and banking
  { id: 1796, s: [4, 3, 4, 4, 5, null], r: ["Payments analyst: product and data work in a payments business.", "Competitive bank scheme; payments interest helps.", "Global bank, structured programme.", "Good payments career path.", "Payments, a top sector for Alex.", NO_PAY] },
  { id: 2319, s: [3, 3, 4, 4, 3, null], r: ["Client advisory: relationship-heavy, less data.", "Competitive.", "Global bank.", "Strong private-banking ladder.", "Wealth management.", NO_PAY] },
  { id: 2129, s: [4, 3, 4, 4, 3, null], r: ["Asset management analysis: research and modelling.", "Competitive; economics fits.", "Global financial group.", "Good investment track.", "Asset management.", NO_PAY] },
  { id: 2137, s: [3, 2, 4, 4, 3, null], r: ["Markets: trading support and analysis, fast-paced.", "Highly competitive markets intake.", "Global financial group.", "Strong markets ladder.", "Commodities.", NO_PAY], stretch: "Markets interviews test mental maths and market views under time pressure." },
  { id: 1777, s: [4, 3, 4, 4, 3, null], r: ["Equity research: modelling and writing, close to economics.", "Small intake.", "Large asset manager.", "Strong research career.", "Asset management.", NO_PAY] },
  { id: 1775, s: [3, 2, 4, 4, 3, null], r: ["Real estate asset management: finance-heavy.", "Very selective.", "Top private-markets firm.", "Excellent ladder.", "Real estate.", NO_PAY] },
  { id: 196, s: [4, 3, 4, 4, 3, null], r: ["Finance scheme with commercial analysis.", "Competitive FMCG finance scheme.", "Global brand, renowned scheme.", "Route to finance leadership.", "Consumer goods.", RYI] },
  { id: 52, s: [4, 4, 4, 4, 3, 3], r: ["Finance graduate: commercial analysis and reporting.", "Economics graduates are a natural fit.", "Global FMCG brand.", "Finance leadership track, often with a qualification.", "Consumer goods.", "£33,000 stated, below London grad finance roles."] },
  { id: 1932, s: [3, 4, 4, 4, 3, 4], r: ["Business banking: client relationships with some analysis.", "Large intake.", "Big structured scheme.", "Clear banking ladder.", "Banking.", "£45,000 stated."] },
  { id: 325, s: [3, 2, 4, 4, 3, null], r: ["Quant strategies: heavy maths and coding.", "Needs a maths, physics or CS degree in practice.", "Global bank.", "Strong quant ladder.", "Banking.", RYI] },
  // ---- quant
  { id: 620, s: [3, 1, 5, 5, 3, 5], r: ["Quant research: maths-heavy, more than Alex wants.", "Extremely selective; usually top maths or CS graduates.", "Top trading firm.", "Exceptional growth.", "Trading.", "Among the highest graduate pay in London."], grad: "yes" },
  { id: 2963, s: [3, 1, 4, 4, 3, null], r: ["Quant research: heavy maths and statistics.", "Extremely selective.", "Leading hedge fund.", "Strong quant ladder.", "Trading.", NO_PAY] },
  { id: 2920, s: [3, 1, 4, 4, 3, null], r: ["Quant research.", "Extremely selective.", "Leading trading firm.", "Strong quant ladder.", "Trading.", NO_PAY] },
  { id: 2923, s: [3, 2, 4, 4, 3, null], r: ["Quant trading: fast decisions, games and probability.", "Very selective.", "Leading trading firm.", "Strong trading ladder.", "Trading.", NO_PAY] },
  // ---- software and product
  { id: 2316, s: [2, 2, 4, 4, 4, null], r: ["Software engineering: more code than Alex wants day to day.", "Engineering scheme; no CS degree.", "Global bank, big tech programme.", "Strong engineering ladder.", "Fintech.", NO_PAY] },
  { id: 3345, s: [2, 2, 4, 5, 5, null], r: ["Software engineering, not Alex's preferred work.", "Very selective engineering hire.", "Product company.", "Fast growth.", "Data and AI platform.", NO_PAY] },
  { id: 3227, s: [2, 2, 4, 4, 4, null], r: ["Software engineering.", "Engineering hire; no CS degree.", "Consumer tech scale-up.", "Good engineering path.", "Consumer tech.", NO_PAY] },
  { id: 3162, s: [2, 2, 4, 4, 5, null], r: ["Software engineering at an AI data company.", "Very selective engineering hire.", "AI scale-up.", "Fast growth.", "AI.", NO_PAY] },
  { id: 1962, s: [2, 3, 4, 4, 4, null], r: ["Backend engineering.", "Graduate engineering programme, open to coders from any degree.", "Exchange group, structured.", "Good engineering path.", "Fintech.", NO_PAY] },
  { id: 1931, s: [2, 3, 4, 4, 3, 4], r: ["Software engineering.", "Large scheme, open to self-taught coders.", "Big structured scheme.", "Engineering ladder.", "Banking.", "£48,500 stated."] },
  { id: 1185, s: [2, 2, 4, 4, 5, null], r: ["Front-end engineering.", "Selective engineering hire.", "Fast-growing AI company.", "Fast growth.", "AI.", NO_PAY] },
  // ---- operations, FMCG, sport and the rest
  { id: 2377, s: [3, 4, 4, 4, 3, null], r: ["Supply chain: planning and analytics on physical goods.", "Large scheme; economics fits.", "Global FMCG brand, structured.", "Clear supply-chain leadership track.", "Consumer goods.", NO_PAY] },
  { id: 197, s: [3, 3, 4, 4, 3, null], r: ["Supply chain with analytics.", "Competitive FMCG scheme.", "Global brand.", "Leadership track.", "Consumer goods.", RYI] },
  { id: 2710, s: [3, 3, 4, 3, 3, null], r: ["Engineering business: commercial analysis in an engineering setting.", "Competitive.", "Iconic brand, structured.", "Steady progression.", "Aviation.", NO_PAY] },
  { id: 300, s: [2, 4, 3, 3, 2, null], r: ["General rail programmes, mostly engineering.", "Large public-sector intake.", "Public body.", "Steady progression.", "Infrastructure.", RYI] },
  { id: 321, s: [4, 4, 4, 4, 3, null], r: ["Audit, tax or consulting: Alex would pick a data-led stream.", "Very large intake.", "Big Four, structured.", "Qualification and strong exits.", "Professional services.", RYI] },
  { id: 271, s: [3, 3, 4, 4, 3, null], r: ["Marketing, finance or supply chain rotations.", "Competitive FMCG scheme.", "Global brand.", "Leadership track.", "Beauty and consumer goods.", RYI] },
  { id: 3404, s: [3, 3, 3, 3, 5, null], r: ["Football officiating data: niche but fun.", "Small team; football knowledge counts.", "Sports-data scale-up.", "Niche path.", "Sport, Alex's wildcard interest.", NO_PAY] },
];

/** Deadlines, in days from the seed day. Roles not listed keep no deadline (most standing grad jobs state none). */
export const DEADLINES: Record<number, number> = {
  1944: 1, 1932: 3, 1959: 4, 1962: 4, 2319: 5, 3309: 6, 2137: 7, 1933: 9, 1775: 11, 3250: 12, 2316: 16, 2710: 19,
  1777: 24, 1919: 26, 52: 21, 2377: 40, 1931: 30, 1796: 14, 2129: 18, 1730: 20, 3314: 28,
};

/** A day this week: never before Monday, so the week rings show progress whatever day the seed runs. */
const WEEKDAY = (new Date().getDay() + 6) % 7;
const wk = (d: number) => Math.max(d, -WEEKDAY);

interface App {
  id: number; status: ApplicationStatus; appliedDay?: number; nextAction?: string; nextDue?: number; notes?: string;
  /** [day, from, to] moves, oldest first */
  log: [number, ApplicationStatus | null, ApplicationStatus][];
}
export const APPLICATIONS: App[] = [
  { id: 3314, status: "interview", appliedDay: -16, log: [[-18, null, "interested"], [-16, "interested", "applied"], [-10, "applied", "tests"], [-7, "tests", "tests_done"], [-2, "tests_done", "interview"]] },
  { id: 1730, status: "hirevue", appliedDay: -11, log: [[-13, null, "interested"], [-11, "interested", "applied"], [-1, "applied", "hirevue"]] },
  { id: 2129, status: "tests", appliedDay: -8, log: [[-9, null, "interested"], [-8, "interested", "applied"], [-1, "applied", "tests"]] },
  { id: 2377, status: "tests_done", appliedDay: -14, log: [[-15, null, "interested"], [-14, "interested", "applied"], [-6, "applied", "tests"], [wk(-1), "tests", "tests_done"]] },
  { id: 1919, status: "applied", appliedDay: -9, log: [[-10, null, "interested"], [-9, "interested", "applied"]] },
  { id: 1777, status: "applied", appliedDay: -4, log: [[-5, null, "interested"], [-4, "interested", "applied"]] },
  { id: 1796, status: "applied", appliedDay: wk(-2), log: [[-3, null, "interested"], [wk(-2), "interested", "applied"]] },
  { id: 52, status: "applied", appliedDay: wk(-1), log: [[-2, null, "interested"], [wk(-1), "interested", "applied"]] },
  { id: 1933, status: "applying", nextAction: "Finish the 'Why Lloyds?' answer (250 words)", nextDue: 2, log: [[-3, null, "interested"], [-1, "interested", "applying"]] },
  { id: 1959, status: "applying", log: [[-2, null, "interested"], [0, "interested", "applying"]] },
  { id: 3309, status: "applying", log: [[-4, null, "interested"], [-2, "interested", "applying"]] },
  { id: 3250, status: "interested", log: [[-1, null, "interested"]] },
  { id: 2319, status: "interested", log: [[-2, null, "interested"]] },
  { id: 2710, status: "interested", log: [[-1, null, "interested"]] },
  { id: 620, status: "rejected", appliedDay: -20, log: [[-22, null, "interested"], [-20, "interested", "applied"], [-6, "applied", "rejected"]] },
  { id: 2963, status: "rejected", appliedDay: -25, log: [[-26, null, "interested"], [-25, "interested", "applied"], [-12, "applied", "rejected"]] },
  { id: 3227, status: "dismissed", log: [[-5, null, "dismissed"]] },
];

interface Email {
  job: number; day: number; sender: string; subject: string; kind: EmailKind; summary: string;
  statusApplied?: ApplicationStatus; action?: string; due?: number;
}
/** Made-up emails. Senders are example.com, never a real recruiting address: this demo is hosted publicly. */
export const EMAILS: Email[] = [
  { job: 3314, day: -2, sender: "Palantir Recruiting (demo) <demo@example.com>", subject: "Next steps: Deployment Strategist interviews", kind: "interview_invite", summary: "Invited to the decomposition interview round.", statusApplied: "interview", action: "Pick a slot for the decomposition interview", due: 1 },
  { job: 1730, day: -1, sender: "PwC Graduate Recruitment (demo) <demo@example.com>", subject: "Your HireVue video interview", kind: "assessment_invite", summary: "Invited to a recorded video interview.", statusApplied: "hirevue", action: "Record the HireVue video interview", due: 4 },
  { job: 2129, day: -1, sender: "Macquarie Early Careers (demo) <demo@example.com>", subject: "Online assessment: Macquarie Asset Management", kind: "assessment_invite", summary: "Numerical and situational-judgement tests.", statusApplied: "tests", action: "Complete the numerical and situational judgement tests", due: 2 },
  { job: 1796, day: -2, sender: "JPMorganChase Campus Recruiting (demo) <demo@example.com>", subject: "We've received your application", kind: "received", summary: "Application received." },
  { job: 620, day: -6, sender: "Jane Street Recruiting (demo) <demo@example.com>", subject: "Your application to Jane Street", kind: "rejection", summary: "Not progressing this time.", statusApplied: "rejected" },
];
