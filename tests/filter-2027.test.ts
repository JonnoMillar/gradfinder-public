/**
 * The 2026-09-23 criteria pass. Every "drops" case is a real title Jonno was shown in the kept list and
 * objected to; every "keeps" case is a real kept title that a careless version of the same rule would lose.
 */
import { describe, expect, it } from "vitest";
import { excludedReason, intakeStatus, requiredLanguage } from "@/lib/pipeline/filter";

const L = { locationRaw: "London", today: "2026-09-23" };
const why = (title: string, extra: Record<string, unknown> = {}) => excludedReason({ ...L, title, ...extra });

describe("roles Jonno does not want", () => {
  it.each([
    ["Engineering Graduate Programme 2027", "excluded_function:engineering"],
    ["Mechanical Engineering Graduate Programme 2027", "excluded_function:engineering"],
    ["Graduate Geotechnical Engineer 2027", "excluded_function:engineering"],
    ["Graduate Flood Risk & Hydrology Engineer 2027", "excluded_function:engineering"],
    ["Graduate Control Systems Engineer 2027", "excluded_function:engineering"],
    ["Engineering Technician", "excluded_function:engineering"],
    ["Graduate Pest Control Technician", "excluded_function:engineering"],
    ["Environment and Infrastructure Graduate Programme 2027", "excluded_function:environment"],
    ["Environmental Graduate & Environmental Consultant", "excluded_function:environment"],
    ["Environmental & Sustainability Manager - Graduate Trainee", "excluded_function:environment"],
    ["Actuarial Graduate Programme 2027", "excluded_function:actuarial"],
    ["Register Your Interest - Pensions Governance Graduate 2027", "excluded_function:actuarial"],
    ["Register Your Interest - Risk Advisory Graduate Programme 2027", "excluded_function:risk_advisory"],
    ["Graduate Risk & Advisory Analyst 2027", "excluded_function:risk_advisory"],
  ])("drops %s", (title, reason) => expect(why(title)).toBe(reason));

  it("drops internships, placements, insight programmes and events, by title and by kind", () => {
    expect(why("Graduate Intern - Electrical/Controls Engineer")).toMatch(/^not_a_grad_role/);
    expect(why("Global Markets & Investment Banking Women's Immersion Programme 2027")).toMatch(/^not_a_grad_role/);
    expect(why("Ratings Forward: S&P Global Early Careers Networking Event 2026")).toMatch(/^not_a_grad_role/);
    expect(why("School Experience Programme")).toMatch(/^not_a_grad_role/);
    expect(why("Discover Your Deloitte - Women into First Year 2027")).toMatch(/^not_a_grad_role/);
    // the LLM classified these; the title alone would not have caught them
    expect(why("Anthropic Fellows Program, ML Systems & Reinforcement Learning", { kind: "internship" })).toBe("excluded_kind:internship");
    expect(why("Summer Analyst 2027", { kind: "placement" })).toBe("excluded_kind:placement");
  });

  it("drops a role that needs another language, but not one that merely welcomes it", () => {
    expect(why("Associate, Client Service, Dutch Speaker, 2027")).toBe("language_required:dutch");
    expect(why("Graduate Associate, Client Services - Italian Speaker (2027 Start)")).toBe("language_required:italian");
    expect(why("Graduate Customer Intelligence Executive - French Speaking 2027")).toBe("language_required:french");
    expect(why("Research Analyst - German-speaking 2027")).toBe("language_required:german");
    expect(requiredLanguage("Graduate Analyst 2027", "Fluency in Japanese is essential for this client-facing role.")).toBe("japanese");
    expect(requiredLanguage("Graduate Analyst 2027", "Spanish or Portuguese would be an advantage.")).toBeNull();
    expect(requiredLanguage("Graduate Analyst 2027", "Native Mandarin speakers are encouraged to apply.")).toBeNull();
    expect(why("Associate, Client Service, English Speaker, 2027")).toBeNull();
    expect(why("Associé(e), Service à la clientèle - Francophone (2027)")).toBe("language_required:francophone");
    // real false positive from the dry run: a country, not a language requirement
    expect(requiredLanguage("Graduate Nuclear Safety Consultant 2027", "Our reach is international, with our support being required in Czech Republic, Finland, Belgium, Japan, Canada and more.")).toBeNull();
    // ...and a real requirement phrased without "fluent"
    expect(requiredLanguage("Medical Information Specialist Graduate Opportunity 2027", "Are you confident communicating clearly and knowledgeably with customers over the phone and via email in Spanish & English?")).toBe("spanish");
  });

  it("drops a board's 'Copy of' duplicate", () => {
    expect(why("Copy of Graduate Associate, Client Services (2027 Start)")).toBe("duplicate:copy_of");
  });

  it("drops a role whose deadline has passed, and one the employer has closed", () => {
    expect(why("Graduate Analyst 2027", { deadline: "2026-09-20" })).toBe("deadline_passed");
    expect(why("Graduate Analyst 2027", { deadline: "2026-09-23" })).toBeNull();
    expect(why("Operations Graduate Associate", { startText: "September 2027", liveness: { status: "closed", evidence: "no longer listed on attio's Ashby job board" } }))
      .toBe("closed:no longer listed on attio's Ashby job board");
    // a check that could not read the page is not evidence of anything
    expect(why("Operations Graduate Associate 2027", { liveness: { status: "unknown", evidence: "HTTP 403" } })).toBeNull();
  });
});

describe("roles that must survive", () => {
  it.each([
    "Software Engineering Graduate Programme 2027",
    "Site Reliability Engineer, Graduate 2027",
    "Electronic Trading Software Engineer - Graduate 2027",
    "Graduate AI Engineering Lab 2027",
    "Machine Learning Engineer Graduate 2027",
    "Technology and AI Graduate Programme 2027",
    "Risk Graduate Scheme 2027",                        // market / credit risk stays (Jonno, 2026-09-23)
    "Credit & Political Risk Graduate Programme 2027",
    "Quantitative Risk Analyst 2027",
    "Register Your Interest - Data Governance Graduate Programme 2027",
    "Strategy Graduate Programme 2027",
    "Graduate Commodities Trading Rotational Analyst Programme 2027",
  ])("keeps %s", (title) => expect(why(title)).toBeNull());
});

describe("surveying, property, planning and water (Jonno, 2026-09-23)", () => {
  it.each([
    ["Graduate Quantity Surveyor 2027", "excluded_function:property"],
    ["Commercial Surveying Graduate (Commercial Valuation) - London (September 2027 Start)", "excluded_function:property"],
    ["2027 Graduate Scheme - Property Management", "excluded_function:property"],
    ["2027 Graduate Scheme - Commercial Real Estate", "excluded_function:property"],
    ["Transaction Analyst Graduate (Corporate Real Estate)", "excluded_function:property"],
    ["2027 Graduate Scheme - Planning", "excluded_function:property"],
    ["Planning Economics Graduate Programme 2027", "excluded_function:property"],
    ["Graduate Planner (September 2027 start)", "excluded_function:property"],
    ["Affordable Housing Graduate Programme 2027", "excluded_function:property"],
    ["Infrastructure (Rural) Graduate Programme 2027", "excluded_function:property"],
    ["Graduate Landscape Architect / Landscape Architect", "excluded_function:property"],
    ["Reservoirs Graduate Programmes", "excluded_function:water"],
    ["Water Recycling Operations Graduate 2027", "excluded_function:water"],
    ["Graduate Arboriculturist (Water)", "excluded_function:environment"],
    ["Graduate Land Quality Consultant 2027", "excluded_function:environment"],
    ["Consulting Associate- Contaminated Land and Remediation (Entry Level)", "excluded_function:environment"],
  ])("drops %s", (title, reason) => expect(why(title)).toBe(reason));

  it.each([
    "2027 Wealth Management (Wealth Planning) Graduate Programme",
    "Financial Planning Graduate",                     // dry run 2026-09-23: "Planning Graduate" matched
    "Supply Chain Planning Graduate Programme 2027",   // same
    "Quantitative Valuation Analyst 2027",
    "2027 Blackstone Real Estate Asset Management Analyst",   // investing in property, not property services
    "Real Estate Investment Banking Analyst 2027",
    "Graduate Property & Casualty Underwriter 2027",
    "Corporate Affairs Graduate 2027",                 // Anglian Water, but not water operations
  ])("keeps %s", (title) => expect(why(title)).toBeNull());
});

describe("coverage audit 2026-09-23: real grad roles the filter was losing", () => {
  it("a title naming the full-time job beats the LLM's internship label", () => {
    expect(why("Global Technology Software Engineer Full Time 2027 Analyst - Bromley", { kind: "internship", locationRaw: "Bromley, England, UK" })).toBeNull();
    expect(why("Global Credit Trainee 2027", { kind: "internship" })).toBeNull();
  });
  it("but the label still stands when the title says nothing (these really are internships)", () => {
    expect(why("Quantitative Trader", { kind: "internship" })).toBe("excluded_kind:internship");               // Jane Street
    expect(why("AI & Quantitative Analyst 2027", { kind: "internship" })).toBe("excluded_kind:internship");   // Brevan Howard
    expect(why("Research Analysts (UK) - Autumn 2027 - GRADUATES ONLY", { kind: "internship" })).toBe("excluded_kind:internship"); // Q5, 12 weeks
  });
  it("keeps a combined graduate-and-internship posting, not a graduate intern", () => {
    expect(why("Graduate Economist & Summer Internship Programme 2026/27")).toBeNull();   // RBB Economics
    expect(why("Graduate Intern - Project Engineer")).toMatch(/^not_a_grad_role/);
    expect(why("Banking, Investment Banking, Full Time Analyst, London 2027 - (Applicable for 2026 Citi Summer interns only)")).toMatch(/^not_a_grad_role/);
  });
  it("counts outer-London boroughs as London", () => {
    for (const loc of ["Bromley", "Kingston Upon Thames, England, UK", "Uxbridge", "Harrow, ENG, GB", "Wimbledon"])
      expect(why("Graduate Data Analyst 2027", { locationRaw: loc })).toBeNull();
    expect(why("Graduate Data Analyst 2027", { locationRaw: "Sutton Coldfield, West Midlands" })).toBe("not_london");
  });
  it("roles the not_london rule used to hide, now caught by what they are (dry run 2026-09-23)", () => {
    const uxbridge = { locationRaw: "Dorchester Coventry Exeter Uxbridge Norwich Glasgow" };
    expect(why("Register Your Interest - Graduate Temporary Works Design Engineer 2027", uxbridge)).toBe("excluded_function:engineering");
    expect(why("Register Your Interest - Graduate Electrical Design Engineer 2027", uxbridge)).toBe("excluded_function:engineering");
    expect(why("Teacher of Drama Maternity Cover", { locationRaw: "Ealing, ENG, GB" })).toBe("excluded_function:teaching");
    expect(why("Teacher of Spanish", { locationRaw: "Ealing, ENG, GB" })).toBe("excluded_function:teaching");
    expect(why("Graduate Software Design Engineer 2027", uxbridge)).toBeNull();
  });
});

describe("the LLM's `engineering` label", () => {
  it("does not drop a plainly software title on its own (real mislabels from the dry run)", () => {
    for (const t of ["Engineering Graduate Programme (Backend) 2027", "Graduate Infrastructure Engineer Programme 2027", "Network Engineer 2027", "Linux Engineer 2027", "Infrastructure Security Engineer 2027"])
      expect(why(t, { function: "engineering" })).toBeNull();
  });
  it("still drops physical engineering, whatever the label", () => {
    expect(why("Electrical and Automation Engineering Graduate Scheme 2027", { function: "engineering" })).toBe("excluded_function:engineering");
    expect(why("Graduate Transport Planner 2027", { function: "engineering" })).toBe("excluded_function:engineering");
    expect(why("Graduate Structural Engineer 2027", { function: "software_engineering" })).toBe("excluded_function:engineering");
  });
});

describe("2027 intake", () => {
  it("confirms from the title, the start text or the description", () => {
    expect(intakeStatus({ title: "Graduate Programme 2027" }).status).toBe("confirmed");
    expect(intakeStatus({ title: "Graduate Analyst", startText: "September 2027" }).status).toBe("confirmed");
    expect(intakeStatus({ title: "Graduate Analyst", startText: "2026/27 academic year" }).status).toBe("confirmed");
    expect(intakeStatus({ title: "Graduate Analyst", description: "Our programme is open to students graduating in 2027." }).status).toBe("confirmed");
  });
  it("contradicts only on evidence", () => {
    expect(why("Analyst Programme 2026 (October 2026 Start)")).toBe("wrong_intake:title says 2026");
    expect(why("Technical Graduate - Service Advisory 2026")).toBe("wrong_intake:title says 2026");
    expect(why("Graduate Analyst, Strategy & Analytics", { startText: "Immediate" })).toMatch(/^wrong_intake:start/);
    expect(why("Graduate Integration Developer, London", { startText: "September 2026" })).toMatch(/^wrong_intake:start/);
    expect(why("Graduate Analyst", { description: "This role has an immediate start for recent graduates." })).toMatch(/^wrong_intake:description/);
    expect(why("Graduate Analyst", { description: "Our 2026 intake starts in October." })).toMatch(/^wrong_intake:description/);
  });
  it("keeps a posting that simply does not say — flagged, not dropped", () => {
    expect(intakeStatus({ title: "Graduate Analyst", description: "Join our team in London." })).toEqual({ status: "unknown", why: "no intake year stated" });
    expect(why("Graduate Analyst", { description: "Join our team in London." })).toBeNull();
    // an applications-close date is not an intake
    expect(why("Graduate Analyst", { description: "Applications close on 30 November 2026." })).toBeNull();
    // real false positive from the dry run (ClearScore): company history, not a start date
    expect(why("Graduate Software Engineer", { description: "Revenue has grown 2.5x year-on-year since the start of 2024." })).toBeNull();
    // a title with 2027 wins over a start text that mentions an earlier date
    expect(why("Register Your Interest - Graduate Programmes 2027", { startText: "September 2026" })).toBeNull();
  });
});
