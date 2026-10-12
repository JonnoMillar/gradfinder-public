# Interview cards

Demo data: Alex Morgan is a fictional graduate. In a real setup, `/setup` builds these from your own stories.
Format: `## Question`, then `Type:`, optional `Status: gap | partial`, `Source:`, optional `Story:`, optional STAR cue
lines (`S: trigger | hint`, `T:`, `A:`, `R:`), bullets, optional `Note:` lines.

## Tell me about yourself
Type: Opener
Source: facts.yaml · motivation.md
- Final year of Economics at Bristol, predicted 2:1
- Summer analyst at a regional insurer: claims data in SQL, dashboards in Tableau
- Treasurer of the Economics Society: ran a £14k budget
- Next: a role turning messy data into decisions, ideally in payments or consulting

## Tell me about a time you used data to change a decision
Type: Competency
Source: stories.md S1
Story: The claims dashboard
S: Insurer internship | claims team guessing at backlog
T: Find why claims stalled
A: SQL + Tableau | joined three tables, weekly view
R: Backlog down 18% | team still uses it
- The claims team tracked backlog in a spreadsheet nobody trusted
- You joined three tables in SQL and built a weekly Tableau view by stage
- It showed most stalls sat at one approval step
- The team changed the sign-off rule; backlog fell 18% in six weeks

## Tell me about a time you led a team
Type: Competency
Source: stories.md S2
Story: The society budget
S: Econ Society | 400 members, budget overspent
T: Treasurer: fix the budget
A: Rebuilt it | per-event costs, sponsor pitch
R: £2.1k surplus | two new sponsors
- Took over a society that had overspent the year before
- Rebuilt the budget per event and pitched two local firms for sponsorship
- Finished the year £2.1k up, and the committee kept the model

## Tell me about a time you failed
Type: Competency
Status: partial
Source: stories.md S4
Story: The missed deadline
- Second-year group project: you took on too much and the analysis section ran late
- You told the group early and split it; you now plan in half-days
Note: Still needs a clear result line. Add one in /setup or a store session.

## Why this kind of role?
Type: Motivation
Source: motivation.md
- You like the moment a chart changes what someone does next
- Payments and consulting both put data in front of decision-makers fast
- Add one sourced fact about the firm from its research brief

## Why should we hire you?
Type: Motivation
Source: facts.yaml · S1 · S2
- Technical enough: Python, SQL, Tableau, used on real data
- Commercial enough: ran a real budget and won sponsors
- You finish what you start: the dashboard is still in use

## Tell me about a time you worked under pressure
Type: Competency
Status: gap
Source: none yet
- No confirmed story yet. /setup asks for one.

## What questions do you have for us?
Type: Close
Source: research brief
- What does a first-year analyst own by month six?
- How do graduates pick their second rotation?
