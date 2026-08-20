# Policies + Calibration onboarding redesign — The Short List

Status: implemented on feat/short-list (ship: 5.27.0)
Date: 2026-08-20
Supersedes nothing. Extends: docs/superpowers/specs/2026-08-16-interruption-budget-design.md
Decided by: design tournament, 6 proposals, 3 judges (new-user lens, thesis/design-fidelity lens, safety/engine-feasibility lens). Full table in the appendix.

---

## 1. Decision

DashClaw already ships a catastrophe-only policy pack, THESIS.md:120 already declares it the default, and scripts/auto-migrate.mjs:269,308 already seeds it into a self-hosted org at birth — but hosted trial orgs never get it, its rules are not marked ungrantable, and no human surface ever names it. We are not inventing a new posture; we are promoting the one that already exists into a named object called **the Short List**: at most ten lines, the only rules in the system permitted to interrupt an unattended run, hard-capped and mostly ungrantable, with every other rule in the org — from any pack, template, generator, or manual create — forced to warn and serving only as calibration feed. A brand-new org is governed with zero clicks, the calibration controller starts in Shadow so it is learning from the first decision, and the human's first governance decision is "do I agree with these four lines" instead of "which of eighteen packs am I". The two structural additions are (a) retrospective Yes/No verdicts on warn groups, which is the only way a quiet posture ever earns the ten adjudications the controller needs to get quieter, and (b) a misfire card that caps any command-shape misclassification at three interruptions with a one-click, shape-scoped exception — the mechanism that was structurally absent on 2026-08-16 when a read-only git log scored 100 and produced 1,759 interruptions in seven days. /calibration is deleted as a page and folded into /policies as a section, which returns one slot to the surface budget (54 → 53) and is what THESIS.md always said /policies was for.

---

## 2. Default posture ladder

### 2.1 What counts as catastrophe

Four categories, and nothing else qualifies regardless of what proposed it:

- **(a) Irreversible without a backup the user controls.** rm -rf on non-regenerable paths, DROP TABLE, TRUNCATE, DELETE FROM without a WHERE, mkfs, disk wipe, git push --force.
- **(b) Moves a secret across a trust boundary.** Writes to .env, .env.local, .env.production, secrets/**, *.pem, id_rsa*, *.key.
- **(c) Spends real money.** The eleven spend action types already enumerated in the spend-lockdown pack: payment, purchase, spend, prepay, buy_credits, top_up, subscription_create, subscription_change, billing_change, domain_purchase, card_charge.
- **(d) Runs away.** More than 200 governed actions in 10 minutes from one agent. This is not itself a catastrophe; it is the net that catches the loop that produces the other three.

Deliberately NOT catastrophe: anything read-only, anything inside the working tree, anything a git revert undoes, anything defined by a risk score below the 100 clamp. Category (a) is expressed as a risk_threshold at the 100 clamp because that is where the scorer's own arithmetic puts it (security base 80 + irreversible 15 + push 10 = 105, clamped) and because a lower threshold is exactly the 2026-08-16 failure with the outcome upgraded from annoying to fatal.

### 2.2 The four seeded lines (day 0, zero clicks)

Three of these ship today in app/lib/guardrails/packs/catastrophe-only/policies.yml. One is new.

| # | Name | Type | Rules | Tier | Grantable |
|---|------|------|-------|------|-----------|
| 1 | Catastrophe Pack — Block Mass-Destructive Operations | risk_threshold | threshold 100, action block | BLOCK | n/a (blocks never wait) |
| 2 | Catastrophe Pack — Hold Secret-File Writes for Approval | protected_path | action require_approval, the seven existing globs | HOLD | ungrantable |
| 3 | Catastrophe Pack — Hold Force-Push Over Protected Branches | (seam decided in plan, see section 9.1) | force-push to main/master/release branches | HOLD | grantable (single-use) |
| 4 | Catastrophe Pack — Rate-Limit Runaway Agents | rate_limit | max_actions 200, window_minutes 10, action warn | WATCH | n/a |

Changes to the shipped pack, and only these:

- Line 2 gains ungrantable: true. It does **not** gain read-side globs. Reads of .env and *.key are common and legitimate; an ungrantable hold on reads is a 1,759-shaped hazard with every relief valve removed by design. If evidence later says reads matter, they ship as a separate grantable line.
- Line 3 is new — force-push over a protected branch as a HOLD (section 9.1). Real money is NOT seeded; it is the first suggested Short List addition (section 9.2).
- Every line gains rules.short_list: true. That flag is the entire two-tier mechanic: a rule may interrupt if and only if short_list is true.

No history-rewrite line is added. git push --force already clamps to 100 and is blocked by line 1, and block_action_type cannot express "force-push over a protected branch" today (matchActionType takes an action_types list plus an optional target_prefix — there is no branch or shape predicate). Adding a rule that either never fires or over-blocks is worse than the coverage we already have. See open question 1.

### 2.3 The Watch tier

Every rule created by any other route — pack install, template, Generate with AI, manual create, shield template — is written with action forced to warn and no short_list flag. The install banner states it: "Installed 6 rules in Watch. They record and feed calibration; none of them can interrupt until you promote them." Promotion to HOLD is a one-click, evidence-backed act in Needs your call, never automatic, never on install.

### 2.4 The ten-line cap

The Short List holds at most ten lines. Adding an eleventh requires removing one, in the same dialog. This is THESIS falsifier #3's anti-regrowth mechanic applied to policy instead of to pages, and it is what makes catastrophe-only a structural property rather than a vibe. Raising the cap is a one-constant change and requires the same written-reason discipline as a surface-budget ceiling.

### 2.5 Calibration at day 0 and the escalation triggers

- **Day 0, zero clicks.** settings.mode = shadow, target_rate = 10%. Shadow costs nothing, changes nothing, and means the theta series and the "would have relieved 12 of 14" evidence already exist the moment the tenth verdict lands. Off is never the resting state for a new org.
- **At 10 labeled adjudications**, a single row appears in Needs your call with the forecast pre-computed: "Fewer interruptions is ready. It would have skipped 12 of your last 14 approval requests and kept both catastrophe holds." One click switches Relief on. It does **not** arm itself. MAINTAINER.md constitution §3 — "Automated systems may PROPOSE policy tuning; a human applies it. No auto-applied enforcement changes, ever" — has no loosening exemption, and relief being safe by construction is a reason it is a one-click row rather than a two-step confirm, not a reason to skip the click.
- **Adjudications come from two sources.** Real approve/deny verdicts on /approvals, and retrospective Yes/No verdicts on warn groups (section 4.4). Without the second source a catastrophe-only posture produces perhaps three to ten verdicts a week and Relief is weeks away; this is the tension every quiet-default design has and the only one anyone solved.
- **Active mode** (the arm that adds interruptions) is offered only after the observed false-interruption rate has stayed within target for seven consecutive days, and keeps its existing two-step confirm. It is never suggested by the system and shadow-only evidence may never justify it.
- **Tightening is never automatic.** A Watch rule that accumulates evidence surfaces as a tighten proposal with its real numbers; ratify promotes it to HOLD and onto the Short List, subject to the ten-line cap.

### 2.6 Interrupt-rate target

Five or fewer human interruptions per seven days for a single coding agent at typical volume. The Short List is structurally incapable of the 1,759 number: one of its four classes blocks rather than asks, two match rare acts, the fourth only warns, and no rule outside the list can interrupt at all. The shipped interruption budget (50/24h policy grain, 10/24h shape grain) stays wired as a backstop that should never fire, and becomes **visible copy for the first time** in the Interruptions stat card. If it fires on a Short List line that is a bug report, and because ungrantable rules cannot be auto-demoted (evaluate.ts:631), the loosening proposal must say exactly that rather than offering deactivation — which is already the shipped behaviour.

**Not adopted:** a new user-set org-grain daily interrupt cap. It was the strongest single idea in the tournament for an org drowning in score-based asks, but under the Short List the only rules that can interrupt are already exempt from budget demotion by design, so a third budget grain would be nearly inert while adding a documented, burnable bypass. What was actually missing is that the two shipped grains render nowhere. We ship the report, not a third grain.

---

## 3. Day-0 click path

Terminal commands in the human's role: zero. GitHub visits: zero. The install itself (npx dashclaw up, or the plugin install) is exempt under HUMAN-EXPERIENCE.md as the act of installing a CLI.

1. **Org is born, seeded server-side.** Self-host: scripts/auto-migrate.mjs already calls seedCatastrophePack at org creation. Hosted: the workspace-provision path gains the same call, so a Google-sign-in trial org gets the identical Short List instead of zero policies. The seeder is already idempotent per policy name.

   **The seed guard, load-bearing:** seed only when the org has zero guard_policies rows **and** zero recorded decisions, ever. An org with history — Wes's own org after 2026-08-16 is exactly that shape — is never auto-written; it gets a dismissible "Install the Short List" card on /policies instead. Seeding must never fail provisioning if it throws.

2. **/connect, card one, unchanged.** "Connect Claude in two minutes", one keyless OAuth button.

3. **/connect, card two — the receipt.** Replaces today's "Pick your rules" card. Header: "Your Short List is live". Renders the four seeded lines read-only with their state chips, in place, no navigation, no modal, under the sentence "One of these refuses outright. Two hold for your approval. Everything else runs and is recorded." One primary button: "Review the Short List" → /policies. One quiet line: "Undo seed" (available 24h, one click). One demoted line: "Add a pack when you want more than catastrophe coverage. Pack rules start in Watch."

   An auto-write the user reads immediately is a disclosure. An auto-write they discover later is a presumption.

4. **The agent runs.** Governed actions stream to /decisions as allow and warn. Nothing interrupts. This part must be boring.

5. **The first hold.** The agent writes .env — which the existing SessionStart liveness probe already does synthetically. Line 2 holds it. /approvals shows one card. The human clicks Approve. First interruption, and it is the demo. Zero clicks were spent getting here.

6. **/policies, first visit.** Above the fold: two stat cards, then the Short List with its one hit, then Needs your call carrying a warn group — "34 x npm test warned by Test Verification Gate over 14 days" — with the pair "Would you have wanted these stopped? Yes / No". Two clicks. That is calibration underway: two labeled adjudications, zero interruptions spent to get them.

7. **Optional, one click, from anywhere.** On any /decisions row (the existing context-menu registry, app/components/context-menu/actionRegistry.tsx) or any /approvals card: "Never let this happen unattended". It shows the exact rule it would write, derived from that decision's commandShapeKey bucket plus its action_type, then arm-and-confirm writes a fifth Short List line tagged "added by you from a decision on Aug 18". Undoable for 7 days. Blocked with an explanation when the list is at ten.

---

## 4. /policies redesign

Route unchanged. Title unchanged: **Policies**.

**Subtitle (exact copy):** "A short list of things that stop your agent. Everything else is watched and measured."

Top action row: six buttons cut to three. **Add a rule** (absorbs Generate with AI), **Packs** (absorbs Import pack / YAML; links to /policies/packs, which stays a page), **Export proof**. Test guardrails moves into the Everything-else section header, where it already operates.

### 4.1 Alert row (conditional, above everything)

The existing inert-rule banner, with one carve-out made explicit: if an inert rule is a BLOCK or a Short List line, it renders here as an alert and never behind a disclosure. A silently neutered block is exactly the false confidence the product exists to prevent. Non-catastrophe inert rules render as a struck-through row inside Everything else instead.

### 4.2 Two stat cards (above the fold, no section header)

- **"Interruptions, last 7 days"** — the number that made the maintainer disable everything, given permanent top billing, with the attention-minutes sentence beneath it. Second line, only when something is over budget: "2 rules crossed 50 interruptions in 24 hours and are warning instead of asking. They are in the list below." This is the first time the shipped interruption budget appears in the product.
- **"Pending approvals"** — count plus "Open Approvals inbox".

Cut: "Enforcement · active rules" (its number is now the Short List counter) and "Decisions · last 30d" with its mini bar chart (belongs on /decisions) and "Governed agents" (belongs on /decisions).

### 4.3 Section: **The Short List**

Sub-header: "The only rules that can interrupt an unattended run." Counter on the right: "N of 10 lines."

One row per line: a state chip carrying the **word** BLOCK / HOLD / WATCH (never colour alone), the class name, the plain-English scope in one line, a 30-day hit count, and two controls — **Details** (expands to the compiled rule, its hit history, its provenance, and its named exceptions with dates and Undo) and **Off** (arm-and-confirm deactivation, logged, undoable).

Under a BLOCK or HOLD line, one grey sentence: "Ungrantable — no grant, approval pause, interruption budget, or automatic tuning can lift this."

Footer row, always visible: "+ Add a line from a decision you have seen. N slots left." with a button "Pick from recent decisions" opening the last 20 interruptible-class decisions to convert.

### 4.4 Section: **Needs your call**

TriageInbox, all five queues, all arm/confirm/dismiss/undo plumbing unchanged. Sub-header: "Observed patterns become one decision, one click. Verdicts here cost your agent nothing."

Four changes:

1. **Queue order is friction-removing first.** Loosening and over-budget proposals, then calibration proposals, then warn groups, then tuning, then tightening. A page that opens with "here is more enforcement you could add" is a page people close.
2. **An empty queue renders nothing at all.** No empty card, no "Nothing waiting" box on day 0. An empty to-do list still reads as homework.
3. **Retrospective verdicts.** Every warn-group row gains a pair: "Would you have wanted these stopped? **Yes** / **No**". This writes a labeled adjudication through the existing contractClient verdict plumbing and is the primary calibration feedstock for a quiet posture. See section 8 for the guardrails that keep it from poisoning the controller.
4. **New queue kind, pinned first: MISFIRE.** When one command shape is held three times in 24 hours by a Short List line, a row appears: "git log was held by Secret exfiltration 3 times in 24 hours. Read-only?" Two-click arm/confirm writes a shape-scoped exception on that line, listed inline under the line with its date and an Undo; the line keeps enforcing everything else. This caps a scorer misclassification at three interruptions instead of 1,759, works even on ungrantable lines because it is a human click rather than an auto-demotion, and keeps exception accumulation visible rather than discovered.

### 4.5 Section: **Calibration** (below the fold, expanded by default)

Full detail in section 5. Anchor: /policies#calibration.

### 4.6 Section: **Everything else — watched, recorded, not interrupting** (collapsed)

The existing Ledger, renamed. Three lenses kept; default lens is **Plain English** (was Sentences) under 10 rules and **Table** at 10 or more. The Table lens gains one column, **Tier** (Short List / Watch), so the two-tier model is legible in the raw data. Section header carries "Test rules against past actions". Empty state at three or fewer rules: "Start from a pack instead of a blank rule" with the packs link.

### 4.7 Section: **Outside decision provider** (collapsed, last)

Unchanged copy: "An outside engine can tighten decisions here. It can never loosen them."

### 4.8 Cut and demoted

**Deleted outright:**

- **PresetsShields.tsx**, both halves — the "Active mode" card and the ten-shield toggle grid. Nine of the ten shields are one-rule packs competing with the pack gallery, and a grid of ten toggles with no forecast is a machine for making the product annoying; deploy_gate, api_review and outbound_gate are precisely the volume classes that produced 1,759. The ten SHIELDS definitions survive as templates inside "Add a rule", where they land in Watch like everything else.
- **ModeDrawer.tsx**. The importMode server path stays as an API so mode-tagged rows in existing orgs keep working and keep rendering in the ledger.
- **GlossaryStrip.tsx**. Six terms defined for a page that after this redesign uses three. A glossary on a settings page is an admission the labels failed; the fix is the labels (section 5.4), not the key.
- Three of six top-row buttons (Import pack / YAML → inside Packs; Generate with AI → inside Add a rule; Test guardrails → Everything-else header).
- Two of four PostureHero stat cards (see 4.2).
- The prose friction sentence — it becomes the Interruptions stat card's number.
- **app/calibration/page.jsx** (section 5).
- The "Your agents run unchecked until you apply a mode" copy. Under this design it is factually false on day 0.
- The /connect and /setup pack-gallery headline cards, demoted to one line each.

**Demoted, not deleted:** the Ledger (collapsed, renamed, no longer the destination of the page), the external provider panel (bottom, collapsed), ApprovalPausePanel (stays exactly where it is, directly under the stat cards — it is the honest relief valve — and gains one line: "It cannot lift a Short List hold.").

**Kept untouched:** TriageInbox's grammar, ApprovalFloodBanner, /policies/packs as a page (the ceiling was raised for it six days ago on an approved RFC; reversing that on reasoning the RFC already considered is churn), all 17 policy types.

---

## 5. /calibration — merged, not redesigned in place

**app/calibration/page.jsx is deleted.** Its content becomes section 4.5 of /policies. next.config.js gains a 308 redirect from /calibration to /policies#calibration — a config redirect, not a page file, so the app page count genuinely drops 54 → 53.

**The sidebar item stays.** Same Govern group, same position, same icon, relabelled **Tuning**, href /policies#calibration. Deleting the nav entry would trade a page refund for a discoverability regression, and the word "calibration" already appears nowhere on /connect or /setup, so nobody arrives at it as it is.

Justification for the merge in the product's own terms: THESIS.md scopes /policies as "a small set of safety switches plus calibration review". Calibration review living on its own page is the drift; the section is the thesis executed. The whole page already runs on one route pair, so nothing is lost by moving the client.

### 5.1 Above the section's own fold

**Section header:** "Calibration"
**Sub-header:** "What it has learned, and what it still needs from you."

**The honest state sentence — the most important copy in this spec:**

> "Calibration learns from verdicts, not from traffic. You have given 14 verdicts: 4 from real approvals, 10 from the warn rows above. Relief is on — it stops asking below risk 78, and it can never touch a Short List line, a block, or reach allow."

Its three states are the existing three, kept in spirit and in fact:

- Not ready: "Automatic tuning needs 10 of your approve/deny calls before it can act. You have given 3." The link goes **up to the warn groups on this same page**, not to /approvals — after this redesign /approvals is nearly empty by design and pointing a new user there is a dead end.
- Ready, off: "Ready. It would stop asking below risk 62 and never go past 71, the riskiest action you approved." Button: "Switch on fewer interruptions."
- On: as quoted above, with "See what it skipped" → /decisions.

**Two stat tiles, not four:** "Pausing above risk" (with the Short List floor as sub-label) and "False interruptions in the last 50" against target, with a text label as well as a colour. Adjudications folds into the honest sentence. Agent alarms folds into the callout below and into the inbox.

**Both sparklines survive** with their dashed reference lines. They are the evidence-over-decoration case and the only place the controller's behaviour over time is visible.

**Near-alarm watchlist** as chips. A *fired* alarm surfaces as a row in Needs your call with its existing Reset action — an agent behaving unlike itself is "look now", not a settings item.

### 5.2 Behind one disclosure: "Controller settings"

Nothing is removed from the controller's capability.

- The four-mode picker with its existing two-step confirm on the mode that can add interruptions.
- Target false-interruption rate input, default 10, range 1–50, with Save.
- Agent alarms card with per-row reset.
- Recent adjudications table, 30 rows, with a **Source** column (Approval / Warn review).
- Reset state, behind its confirm, relabelled.

### 5.3 The honesty clause, stated in product copy

Catastrophe-only enforcement starves the controller. Four rare interrupting classes produce three to ten adjudications a week and the controller needs ten before Relief can act. Retrospective warn-row verdicts are the deliberate fix — they convert traffic the agent never noticed into labeled feedback at one click each. Without them, catastrophe-only and calibration are in direct tension and the page would be lying by omission. The state sentence says exactly how many verdicts exist and where they came from, so the failure mode is visible rather than mysterious.

### 5.4 Label replacements (the glossary, deleted by fixing the words)

| Was | Is |
|-----|----|
| Calibrated threshold θ | Pausing above risk |
| Observed rate (last 50) | False interruptions in the last 50 |
| Target false-interruption rate | Acceptable false interruptions — "out of every 100 interruptions, how many may turn out to be things you would have approved. A lower number means more interruptions." |
| Adjudications | Verdicts from you |
| θ movement | Threshold |
| approved · false interruption | approved — we should not have asked |
| Off / Shadow / Relief / Active | Off / Preview / Fewer interruptions / Fewer and more interruptions |
| Reset state | Forget everything it learned |
| Bucket | warn / hold / block |
| Grant | stop asking about this |
| Ratify | apply |
| Agent alarm | denied far more than chance explains |

The Greek letter leaves the UI entirely. It stays in docs/architecture/governance-core-theory.md, which gains a one-line label-mapping table in the same commit. Machine ids on /api/calibration/controller are unchanged — this is a label layer, not a schema change.

---

## 6. ASCII mocks

### 6.1 /policies — day 0, new user, one hit on the Short List

    +----------------------------------------------------------------------------+
    | Policies                                                                   |
    | A short list of things that stop your agent. Everything else is watched    |
    | and measured.                                                              |
    |                                  [ Add a rule ] [ Packs ] [ Export proof ] |
    +---------------------------------+------------------------------------------+
    | INTERRUPTIONS - LAST 7 DAYS     | PENDING APPROVALS                        |
    |   1                             |   0                                      |
    |   about 20 sec of your time     |   [ Open Approvals inbox ]               |
    +---------------------------------+------------------------------------------+
    | Approvals are paused for: nothing.        [ Pause approvals for 1h v ]     |
    | A pause cannot lift a Short List hold.                                     |
    +----------------------------------------------------------------------------+

    THE SHORT LIST                                                 4 of 10 lines
    The only rules that can interrupt an unattended run.
    +----------------------------------------------------------------------------+
    | [BLOCK]  Mass destruction                                   0 hits / 30d    |
    |          rm -rf outside a build dir, DROP TABLE, TRUNCATE, mkfs, wipe,     |
    |          force-push                                                        |
    |          Refuses outright. Never waits on you.        [ Details ]  [ Off ] |
    +----------------------------------------------------------------------------+
    | [HOLD]   Secret-file writes                                 1 hit / 30d     |
    |          writes to .env, .env.local, secrets/**, *.pem, id_rsa*, *.key     |
    |          Ungrantable - no grant, pause, budget or tuning lifts this.       |
    |                                                       [ Details ]  [ Off ] |
    +----------------------------------------------------------------------------+
    | [HOLD]   Real money                                         0 hits / 30d    |
    |          payment, purchase, subscription, top-up, domain buy, card charge  |
    |          Ungrantable.                                 [ Details ]  [ Off ] |
    +----------------------------------------------------------------------------+
    | [WATCH]  Runaway loop                                       0 hits / 30d    |
    |          over 200 governed actions in 10 min - records, never pauses       |
    |                                        [ Details ]  [ Hold instead ]       |
    +----------------------------------------------------------------------------+
    | +  Add a line from a decision you have seen.  6 slots left.                |
    |                                        [ Pick from recent decisions ]      |
    +----------------------------------------------------------------------------+

    NEEDS YOUR CALL                                                   2 waiting
    Observed patterns become one decision, one click. Verdicts here cost your
    agent nothing.
    +----------------------------------------------------------------------------+
    | [misfire]     "git log" was held by Secret-file writes 3 times in 24h.     |
    |               evidence: 3 approvals . 0 denials . read-only shape          |
    |               [ Stop asking about "git log" ]  [ Keep asking ]  [ Why? ]   |
    +----------------------------------------------------------------------------+
    | [warn group]  34 x "npm test" warned by Test Verification Gate, 14 days.   |
    |               None escalated. It has never interrupted anyone.             |
    |               Would you have wanted these stopped?      [ Yes ]  [ No ]    |
    |                                    [ Promote to Hold ]  [ Stop warning ]   |
    +----------------------------------------------------------------------------+
    (queues with nothing in them render nothing at all)

    v  CALIBRATION   see below
    >  EVERYTHING ELSE - watched, recorded, not interrupting                 (0)
    >  OUTSIDE DECISION PROVIDER

### 6.2 The Calibration section — not ready, then on

    --- NOT READY (day 0 .. verdict 9) -------------------------------------------
    CALIBRATION                                                    Preview mode
    What it has learned, and what it still needs from you.
    +----------------------------------------------------------------------------+
    | Calibration learns from verdicts, not from traffic. You have given 3.      |
    | Automatic tuning needs 10 of your approve/deny calls before it can act.    |
    | Preview mode is on: it is recording what it WOULD do and changing nothing. |
    | It can never touch a Short List line, never reach allow, never lift a      |
    | block.                                   [ Review the warn groups above ]  |
    +----------------------------------------------------------------------------+
    | >  Controller settings                                                     |
    +----------------------------------------------------------------------------+

    --- ON (relief switched on by one click at verdict 10) -----------------------
    CALIBRATION                                        Fewer interruptions - 78
    What it has learned, and what it still needs from you.
    +----------------------------------------------------------------------------+
    | Calibration learns from verdicts, not from traffic. You have given 14      |
    | verdicts: 4 from real approvals, 10 from the warn rows above. It stops     |
    | asking below risk 78, and it can never touch a Short List line, a block,   |
    | or reach allow.                             [ See what it skipped > ]      |
    +---------------------------------+------------------------------------------+
    | PAUSING ABOVE RISK              | FALSE INTERRUPTIONS - LAST 50            |
    |   78                            |   6%   ON TARGET (target 10%)            |
    |   Short List floor: 100         |   rolling 20                             |
    |          /\                     |    ___                                   |
    |      ___/  \___/\__             |   /   \____                              |
    |   - - - - - - - - -  ref 100    |  - - - - - - - - - -  ref 10%            |
    +---------------------------------+------------------------------------------+
    | No agents flagged. Two are near the line:  ( claude-code-2 ) ( nightly )   |
    +----------------------------------------------------------------------------+
    | v  Controller settings                                                     |
    |    Mode  ( Off ) ( Preview ) [ FEWER INTERRUPTIONS ] ( Fewer and more )    |
    |          "Fewer and more" is offered once the observed rate holds under    |
    |          target for 7 straight days. It is the only mode that can ADD an   |
    |          interruption.                                                     |
    |    Acceptable false interruptions  [ 10 ] %                    [ Save ]    |
    |    Out of every 100 interruptions, how many may turn out to be things you  |
    |    would have approved. A lower number means more interruptions.           |
    |    Agents denied far more than chance explains   none                      |
    |    What your verdicts taught it   30 rows   Source: Approval / Warn review |
    |                                        [ Forget everything it learned ]    |
    +----------------------------------------------------------------------------+

---

## 7. Reused vs new, and the surface-budget delta

### 7.1 Reused unchanged

- **Routes.** /api/policies (CRUD), /api/policies/summary, /api/policies/templates, /api/policies/simulate, /api/policies/import, /api/policies/loosening, /api/approval-pause, /api/approvals/[actionId]/grant, /api/calibration/controller (GET state; POST mode / target_rate / reset_agent_alarm / reset_state), /api/settings.
- **Seeder.** app/lib/setup/catastrophe-pack.mjs — seedCatastrophePack(sql, orgId), already idempotent per policy name, already called from scripts/auto-migrate.mjs:271,308.
- **Components.** TriageInbox and all five queue clients (contractClient, proposalsClient, tighteningClient, looseningClient, calibrationClient) with their arm/confirm/dismiss/undo grammar; InboxSection; ApprovalPausePanel; ApprovalFloodBanner; the inert-rule banner; Ledger and all three lenses; Sparkline; StatTile; PackGallery at /policies/packs; the /decisions context-menu registry.
- **Engine.** applyInterruptionBudget, commandShapeKey, deriveOverBudgetShapes, the ungrantable gate at evaluate.ts:457/533/631/1011, all 17 policy types.

### 7.2 New code (no new routes, no new pages, no new policy types)

1. **Hosted seed call.** The workspace-provision path calls seedCatastrophePack. Idempotent, must not fail provisioning on throw. Touches __tests__/unit/hosted/workspace-provision.test.js, a flagged change-entropy biomarker — expect churn there.
2. **The seed guard.** Zero policies AND zero decisions, else render a dismissible install card instead.
3. **The fourth seeded line** in policies.yml (real money), plus ungrantable: true and short_list: true on the existing lines, plus their pack tests.
4. **The Watch-tier transform.** A client-side (and repository-side, for import) forcing of action to warn and stripping of short_list on every non-Short-List write path. One shared helper, called from the import payload builder and the create/patch path.
5. **Short List derivation and the ten-line cap** on the summary payload and the create path.
6. **MISFIRE queue kind** — a sixth TriageInbox kind fed by deriveOverBudgetShapes at a threshold of 3/24h for short_list rules, writing a shape-scoped exception through the existing policies CRUD.
7. **Retrospective warn verdicts** — a Yes/No pair on warn-group rows, writing through the existing verdict endpoint with a new ApprovalAdjudication source value ("warn_review"), plus weighting in the controller's applyAdjudication and a hard rule that shadow-only evidence never moves the threshold in the tightening direction. **This is real controller math and the riskiest new code in the spec; it needs its own tests.**
8. **The /policies section rewrite and the calibration client move.** Deletions listed in 4.8.
9. **next.config.js redirect** /calibration → /policies#calibration, and the sidebar relabel.
10. **Label layer** per section 5.4, plus the docs/marketing sweep required by HUMAN-EXPERIENCE.md clause 4 (grep /calibration across docs, plugins, marketing, maintainer log).

### 7.3 Surface budget

| Dimension | Before | After | Note |
|---|---|---|---|
| App pages | 54 | 53 | −1: app/calibration/page.jsx deleted, replaced by a config redirect. Ceiling **lowered** to 53 in contracts/surface-budget.json and the THESIS.md table in the same commit. |
| API routes | 133 | 133 | Zero added, zero removed. |
| Guard policy types | 17 | 17 | No new type. ungrantable is an existing rules flag; short_list is data. |
| MCP tools / resources | 17 / 3 | unchanged | |
| Node / Python SDK methods | 39 / 59 | unchanged | |
| CLI commands | 15 | unchanged | |
| Migrations | — | zero | Everything rides guard_policies.rules JSON and the existing settings row. |

Amendment reason to record: "2026-08-20: 54 → 53. /calibration folded into /policies#calibration, per THESIS's own scoping of that surface as safety switches plus calibration review. Zero routes changed; the section runs on the same /api/calibration/controller pair. First entry in this log that moves a ceiling down."

---

## 8. Safety invariants the implementation must keep

1. **Never auto-apply an enforcement change, in either direction.** Constitution §3 has no loosening exemption. Relief at ten verdicts is a one-click inbox row with the forecast pre-computed, not a completed fact. Tightening is never automatic at all.
2. **Never auto-seed an org that has history.** Zero policies AND zero decisions, ever. Anything else gets a card.
3. **No score-based BLOCK below the 100 clamp, ever, as a default.** The scorer put a read-only git log at 100 on 2026-08-16. A false block has no human path and the user experiences it as the agent failing.
4. **No default rule may gate action_type "apply".** The hook maps every file write to apply (hooks/dashclaw_pretool.py:214, :621) and the shipped pack's own test asserts apply / "Write: src/app.js" must allow. Any seeded rule matching apply bricks a coding agent on day 0.
5. **Ungrantable is reserved for rare irreversible classes.** It disables the grant path, the approval pause, the interruption budget, and the calibration demote arm simultaneously. Never mark a high-volume rule ungrantable. The escape from an ungrantable flood is an explicit human act — the misfire exception or the Off button — never a silent auto-demotion.
6. **A rule may interrupt if and only if it is on the Short List.** Every other write path forces warn. If a code path can create an interrupting rule without the short_list flag, the two-tier model is a lie.
7. **Relief never reaches allow, never lifts a block, never touches a Short List line**, and is capped by the riskiest action the human actually approved. A single deny retracts it above that score.
8. **Retrospective verdicts are source-flagged, weighted below live verdicts, and may never move the threshold in the tightening direction.** They may unlock Relief; they may never justify Active. This constraint is load-bearing, not advisory.
9. **An inert BLOCK or Short List line renders as an alert above the fold**, never behind a disclosure.
10. **Every forecast states its own window** ("against your last 812 actions, 3 days") and renders "Not enough history yet" rather than a misleading zero. /api/policies/simulate has diverged from live evaluation before, on scope and shape matching, and the page must not lie at the moment a human is deciding.
11. **The honest calibration sentence ships verbatim in spirit.** Calibration learns from verdicts, not traffic; it says how many it has and where they came from. If that sentence is cut for space, the honesty is gone.
12. **Zero terminal steps in the human's role.** Seeding moves into the app; the doctor create-default-policy fix stays only as a self-host repair, and its "Doctor: Log All Actions" row is replaced by calling the shared seeder.
13. **Driven proof before done.** Drive /policies and /connect headless: the receipt renders the four lines, the Short List renders its chips, the Yes/No pair writes a verdict, the misfire row writes an exception that shows inline with an Undo.

---

## 9. Decisions (resolved 2026-08-20 by Wes; items 3-4 delegated to the implementer)

1. **Force-push is a HOLD, not a block.** Wes funds a branch-aware predicate. The scorer may keep its arithmetic; the engine gains a way to express "force-push over a protected branch" so that line 1 (risk 100 BLOCK) is carved out for force-push and a Short List HOLD line catches it instead. The implementation plan decides the exact seam (scorer carve-out vs. a predicate on the rule) after reading the engine; the invariant is: an unattended run that force-pushes over main/master gets an approval card, not a dead run, and a force-push to a feature branch is not catastrophe.
2. **Real money is NOT seeded.** It ships as the first *suggested* Short List addition: a one-click "Add to the Short List" card rendered in the Short List footer for any org that has no real-money line, ungrantable when added. Day-0 seed is therefore three lines (BLOCK mass destruction, HOLD secret-file writes, WATCH runaway), plus the force-push HOLD from item 1 = four seeded lines.
3. **Retrospective verdict weighting (implementer decision):** warn-review verdicts weigh 0.5 of a live verdict in the controller's labeled count; Relief unlock requires 10 weighted verdicts AND at least 3 live approve/deny verdicts. Rationale: a user who has never once seen a real interruption has no calibration of what "would you have wanted this stopped" means; three live verdicts is the smallest floor that anchors the retrospective ones. Warn-review verdicts can never move the threshold in the tightening direction (invariant 8 stands).
4. **The ten-line cap is HARD** (implementer decision): adding an eleventh line forces a removal in the same dialog. Rationale: it is the anti-regrowth mechanic; a soft cap is a warning nobody reads. Raising it is a one-constant change with a written reason, same as a surface-budget ceiling.
5. **Modes and shields authoring UI is deleted**; rows survive. Wes: "complete freedom to edit and delete anything you want."

---

## 10. Appendix: the tournament

Six proposals, three judges, scored 1–10 each. Ranking is the sum.

| Rank | Proposal | Thesis in one line | New-user | Thesis/design | Safety/engine | Total |
|---|---|---|---|---|---|---|
| 1 | **catastrophe-only — The Short List** | Promote the catastrophe pack the product already ships and already declares the default into a named, hard-capped list of at most ten interrupting rules; force everything else to warn; fix calibration's verdict starvation with retrospective warn-row verdicts. | 9 | 9 | 9 | **27** |
| 2 | zero-config-ladder — Rung Zero | Ship a four-rule catastrophe floor before the user decides anything and climb a visible three-rung ladder under one law: DashClaw may quiet itself automatically, but only gets louder when a human clicks. | 8 | 6 | 7 | 21 |
| 3 | inversion-churn — Ten Exits, Welded | Design backwards from the ten moments that make a new user quit and weld each shut, anchored by a user-set daily interruption cap that makes 1,759 arithmetically impossible. | 7 | 4 | 8 | 19 |
| 4 | approvals-first-merge — One Dial | Governance is one question — how much should this thing ask me — so give it one four-position dial and derive the calibration controller mode from it. | 6 | 5 | 6 | 17 |
| 5 | settings-purist — Two Settings, One List | Every element is a setting, a list, or a report; sort them, and the page becomes findable. | 4 | 8 | 4 | 16 |
| 6 | staged-onboarding — The Ramp | Auto-apply one posture at connect, then unlock the page in three stages keyed to evidence rather than calendar days. | 6 | 3 | 3 | 12 |

**Why the winner won.** It was the only proposal whose day-0 claim was already true in the repo — the pack exists, is seeded at org birth for self-host, and THESIS.md:120 already calls it the default — so it adds a name and a human surface to a shipped default instead of inventing a fifth vocabulary. It was also the only entrant that identified and solved the tension every quiet-default design has: catastrophe-only enforcement produces three to ten verdicts a week, the controller needs ten, so week-one calibration is impossible without converting traffic into labels. Its ten-line hard cap is THESIS falsifier #3's own anti-regrowth mechanic applied to policy. All three judges ranked it first or tied-first.

**Why the others lost, and what we took anyway.**

- **zero-config-ladder** reinvented the catastrophe pack as a new "floor" without noticing the pack exists, carried the heaviest concept load in the field (two vocabularies, a 200-decision gate, a printed law, progress bars that read as homework), and leaned on a risk_threshold action-type scope that does not exist — policy.ts:274-297 reads only threshold, action, contain_above. **Grafted: the seed guard (zero policies AND zero decisions) and the floor-misfire card**, both of which are load-bearing here.
- **inversion-churn** had the best diagnosis and the single clearest control in the tournament, but its day-0 posture is one warn rule — a log, not a net — and it silent-arms rules including block-class ones on day 7, the clearest constitution §3 breach in the field. **Grafted: friction-removing queues first, empty queues render nothing, and the principle that the interruption budget must be visible copy.** Its daily cap is explicitly not adopted; see 2.6.
- **approvals-first-merge** had the most impeccable page and the best vocabulary collapse (deriving controller mode from the dial), but auto-promotion at 24h installs two block rules nobody clicked, and its shape-based block rules ("force-push over a protected branch") are not expressible by matchActionType today. It also reversed a six-day-old approved RFC on packs. **Grafted: the framing that no rule at the entry tier fires on a risk score, and pulling the friction forecast out of the modal.**
- **settings-purist** had the best information architecture and by far the best copy in the tournament, attached to the least safe defaults in it: a zero-click seed that blocks action_type apply (every file write) and blocks at risk 90 on the scorer that put git log at 100. **Grafted wholesale: the entire copy and label layer (section 5.4), the glossary deletion, keeping the nav item pointed at the merged section, the inert-BLOCK carve-out, and the forecast-window honesty rule.**
- **staged-onboarding** produced the best single onboarding artifact and a genuinely zero-delta budget, but its seeded rule gates action_type apply — recreating 1,759 on day 0, by design — and marks those rules ungrantable, switching off both brakes built in response to the incident. Its terminal state restores the cluttered workbench intact. **Grafted: the connect-time receipt with its 24h Undo seed.**

**Cross-cutting correction the tournament surfaced.** The design brief stated that "no code path auto-seeds any guard_policies row for a brand-new org." That is wrong, and every proposal built on it inherited the error. scripts/auto-migrate.mjs already seeds the catastrophe pack at org birth for org_default and for a configured org id. The real gaps are that hosted provisioning does not seed, and that no human surface ever names the pack. This spec starts from that fact.
