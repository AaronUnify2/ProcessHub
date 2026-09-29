# Process Hub — data model specification

**Working title.** Naming is an open question (see §11).
**Status:** draft for review. Nothing built yet.
**Date:** 20 September 2026

---

## 1. What this is

A single web app that holds **process maps**, **knowledge base articles** and
**public FAQ content** in one place, so that one fact is written once and
appears everywhere it belongs.

The spine is the **process**. A process owns a map. Knowledge base articles and
FAQ questions are *referenced* from that map — they live in shared libraries,
not inside any one process. Variables (fees, phone numbers, URLs, times) are
referenced from all three.

### 1.1 In scope for v1

- Department / sub-department taxonomy, arbitrarily nested
- Process maps: steps, connections, drag layout, SVG export
- Knowledge base articles as a shared library, referenced from steps
- FAQ questions as a shared library, referenced from steps
- Variables with owners, verification questions and a verification email generator
- An issues register (the "broken processes" deliverable)
- Export: JSON for every scope, plus a viewable HTML wrapper wherever meaningful
- Export: `FAQ.json` in the existing legacy schema, for IT

### 1.2 Explicitly out of scope for v1

- The live call view (phase 2)
- Any call telemetry or per-officer data (phase 2, and needs Records/Privacy first)
- Multi-user editing, accounts, permissions
- Any backend. The GitHub repository is the only server.

### 1.3 Design principles

1. **One fact, one place.** If a value appears twice, it is a variable.
2. **Libraries and references, not ownership.** Articles and FAQs are
   referenced by processes, never owned by them.
3. **Derived data is never stored.** Usage counts, handoff counts and reverse
   indexes are computed at load.
4. **Every export has a viewable form.** Where an export could be read by a
   human, offer a self-contained HTML wrapper alongside the JSON.
5. **Variables resolve live in the app and freeze on export.** An SVG or a file
   sent to a department carries values, not placeholders.

---

## 2. Identity and conventions

- All ids are strings, readable, prefixed by type:
  `tax_`, `proc_`, `step_`, `conn_`, `art_`, `faq_`, `var_`, `iss_`.
- Readable ids matter: they appear inside HTML content and in git diffs.
- Dates are ISO `YYYY-MM-DD`. Month-only review stamps may be `YYYY-MM`.
- All rich text is HTML strings, consistent with the current FAQ content.
- UK English throughout.

---

## 3. Taxonomy

A flat array with `parentId`, which gives arbitrary nesting while remaining
trivial to flatten back to two levels later.

```json
{
  "id": "tax_local_laws",
  "name": "Local Laws",
  "parentId": null,
  "order": 1,
  "collapsed": false
}
```

The taxonomy is a **single register serving three different jobs**. Keep the
fields separate even though they draw from the same list:

| Field | On | Means |
|---|---|---|
| `taxonomyId` | Process | Where the process lives in the tree |
| `departmentId` | Step | Which department performs this step |
| `ownerId` | Variable / Article / FAQ | Who is accountable for the content |

A process with steps in three departments appears in the sidebar under all
three, sorted under its own `taxonomyId`. That is derived, not stored.

---

## 4. Process

```json
{
  "id": "proc_rates_payment_agreement",
  "name": "Rates — payment agreement",
  "taxonomyId": "tax_revenue_rates",
  "status": "draft",
  "owner": "Revenue Manager",
  "lastReviewed": "2026-09-20",
  "purpose": "Customer cannot pay rates in full and requests an arrangement.",
  "entryPoint": "Phone, front counter",
  "resolutionDefinition": "Agreement saved to pre-approved folder and revenue notified.",
  "steps": [],
  "connections": [],
  "issues": [],
  "articleRefs": [],
  "faqRefs": [],
  "canvas": { "cardDetail": "default" },
  "created": "2026-09-20",
  "updated": "2026-09-20"
}
```

`status` — one of `draft`, `mapped`, `reviewed`, `published`, `needs_rework`.
This drives the coverage report: *"220 processes identified, 25 reviewed."*

`articleRefs` / `faqRefs` at process level are for content about the process as
a whole. Step-level attachment is the default (§5).

### 4.1 Issues — the broken-process register

```json
{
  "id": "iss_1",
  "stepId": "step_3",
  "note": "Customer must repeat property ID three times across two systems.",
  "severity": "high",
  "raised": "2026-09-20",
  "raisedBy": "Customer Service"
}
```

`stepId` may be `null` for a process-level issue. One flat list per process
means one report across the whole corpus — which is the artefact the CX
consultants will ask for.

---

## 5. Step

Extends the existing Work Administration unified schema. Three fields are new
and marked.

```json
{
  "id": "step_3",
  "type": "action",
  "x": 400,
  "y": 80,
  "title": "Verify caller identity",
  "departmentId": "tax_customer_service",
  "responsibleRole": "Customer service officer",
  "escalationPoint": "Team leader",
  "timeframe": "2 minutes",
  "sop": "1. Look up property in TechOne\n2. Confirm name and postal address",
  "completionTrigger": "Identity confirmed against TechOne record",
  "script": "<i>\"Before I can discuss the account I'll just confirm a couple of details with you.\"</i>",
  "checks": [
    { "id": "chk_1", "text": "Correct Property ID pasted into TechOne" },
    { "id": "chk_2", "text": "Rate recovery code checked" }
  ],
  "systems": ["TechOne"],
  "articleRefs": ["art_identity_verification"],
  "faqRefs": [],
  "custom": {}
}
```

- `type` — `entry` | `action` | `decision` | `resolution`
- `departmentId` — **new.** Makes handoffs visible and countable.
- `script` — **new.** What the officer says, in the officer's register. Distinct
  from `sop`, which is what the officer does.
- `checks` — **new.** Structured rather than `[ ]` lines in prose, so the live
  call view can render real checkboxes later. Free to add now, expensive later.
- `custom` — free-form key/value for user-added fields, as in the current
  Process Mapper.

The role label varies by step type in the UI (`Receiving officer`,
`Responsible officer`, `Decision maker`, `Closing officer`) but always stores
under `responsibleRole`.

### 5.1 Connection

```json
{
  "id": "conn_7",
  "from": "step_2",
  "to": "step_5",
  "condition": "Usage consistently above 0L/hour"
}
```

`condition` is the arrow label. Filling these in properly is what makes the
phase-2 call view possible — each condition becomes a button.

---

## 6. Libraries

### 6.1 Article

```json
{
  "id": "art_water_meter_side",
  "title": "Which side of the meter?",
  "summary": "How to work out whether a leak is Council's or the owner's.",
  "body": "<p>…</p>",
  "audience": "internal",
  "ownerId": "tax_water",
  "status": "current",
  "lastReviewed": "2026-08",
  "tags": ["water", "leak"],
  "internal": true
}
```

- `audience` — `internal` | `public` | `both`
- `internal` — hard flag. `true` means never include in a public export,
  regardless of anything else.

### 6.2 FAQ question

```json
{
  "id": "faq_water_meter_side",
  "q": "Who is responsible for fixing a water leak?",
  "a": "<p>…</p>",
  "publish": { "tabId": "water", "order": 3, "groupTitle": null },
  "ownerId": "tax_water",
  "status": "approved",
  "lastReviewed": "2026-08",
  "internal": false
}
```

The `publish` block is the mapping into the existing website structure. A
question with no `publish.tabId` exists in the library but is not exported.

### 6.3 Publish tabs

The presentation config for the exported `FAQ.json`. Mirrors the current tab
structure so `FAQ.html` keeps working untouched.

```json
{
  "id": "rural",
  "label": "Building Rural",
  "new": false,
  "intro": "<p>…</p>",
  "footer": "Related: …",
  "lastReviewed": "August 2026",
  "stepperFrom": "proc_rural_build",
  "stepper": []
}
```

`stepperFrom` is the payoff of the whole design: if set, the tab's stepper is
**generated from that process's steps at export time** rather than hand
maintained. Map the process once, and the public step-by-step summary follows.
If `stepperFrom` is null, the literal `stepper` array is used.

### 6.4 Variable

```json
{
  "id": "var_money_300",
  "question": "Is this fee still current for a pre-lodgement meeting: $300?",
  "value": "$300",
  "type": "money",
  "ownerId": "tax_planning",
  "note": "",
  "internal": false,
  "status": "current",
  "lastVerified": "2026-07-14",
  "verifiedBy": "K. Planning Admin"
}
```

- `type` — `text` | `money` | `url` | `phone` | `email` | `time` | `date` | `system`
- `status` — `current` | `pending` | `stale`
- `internal` — `true` redacts or omits the value from public exports. This is
  the lever for internal system names, extension numbers and intranet URLs.
- `lastVerified` drives a staleness report: *"31 variables not verified in
  12 months, 14 of them Planning's."*

### 6.5 System names are variables

Business systems get renamed and replaced, and the name is written into
hundreds of places. Merit has just been retired in favour of the CRM, and the
existing content references it **72 times**. Every internal system name is
therefore a variable of `type: "system"`, with `internal: true`.

Current counts in `CustomerService.html`:

| Variable | Value | Audience | References |
|---|---|---|---|
| `var_sys_intranet` | Eli | internal | 125 |
| `var_sys_requests` | CRM *(was Merit)* | internal | 72 |
| `var_sys_mapping_internal` | Intramaps | internal | 26 |
| `var_sys_property` | TechOne | internal | 12 |
| `var_sys_payments` | BPOINT | internal | 10 |
| `var_sys_eproperty` | eProperty | public | 10 |
| `var_sys_water` | Aqualas | internal | 9 |
| `var_sys_records` | ECM | internal | 5 |
| `var_sys_notices` | Payreq | internal | 3 |
| `var_sys_collections` | Echo *(was Cleanaway Live Collections)* | internal | 1 |
| `var_sys_mapping_public` | Online Mapping | public | — |

Done this way, the next system replacement is one edit instead of a
find-and-replace across the corpus — and the app can show exactly which
processes and steps are affected before you change it.

### 6.6 Three things that are not the same, and must not share a variable

Naming collisions are the trap. A single blanket rename would corrupt content
in all three cases below.

**Internal system vs public system.** Intramaps and Online Mapping are
**two different systems**, not two names for one. Intramaps is internal and
shows customer information; Online Mapping is public and carries only publicly
available data. Two separate variables, and an officer instruction to check
Intramaps must never be rewritten into public copy. Aqualas / "My SDRC Water"
is the opposite case — one system with an internal and a customer-facing name,
so two variables that deliberately resolve to the same thing.

*(Noted for the record: `Intramaps` appears 11 times in published FAQ answers,
but every occurrence is inside the vendor URL path —
`…/spatial/intramaps/?…&project=Online%20Mapping` — and the visible link text
reads "Online Mapping" in all of them. The public copy is correct as it
stands.)*

**Contractor vs system vs form.** "Cleanaway" appears 27 times in the current
content and means three different things:

| Term | Count | What it is | Status |
|---|---|---|---|
| Cleanaway Live Collection | 1 | The system | Renamed to **Echo** |
| Cleanaway Request | 10 | The form | Unchanged |
| Cleanaway | 16 | The contractor | Unchanged |

Only one of the 27 changes. Forms and organisations therefore get their own
variable types rather than being lumped in with systems:

- `type: "system"` — software (Echo, CRM, TechOne)
- `type: "form"` — named forms (Cleanaway Request, DA Form 2, Form 21)
- `type: "org"` — external organisations and contractors (Cleanaway, QBCC)

A form frequently outlives the system that serves it, and an organisation
outlives both.

---

## 7. References

Three distinct mechanisms. Only the third is new.

**1. Variable substitution inside HTML — unchanged.**
`<span class="faq-var" data-var="var_money_300">$300</span>` and
`data-var-href` on links. This already works and already exists across 321KB of
content. Do not change it.

**2. Content cross-links inside HTML — new.**
`<a class="ref-link" data-ref="art_water_meter_side">which side of the meter</a>`
In the editor this opens the target in context. In a public export it either
resolves to a real URL or unwraps to plain text, since the public site has no
article pages.

**3. Attachment references.**
`articleRefs` and `faqRefs` arrays on steps and processes. These drive the
sidebar tree and the "attached content" panel.

### 7.1 Usage index

Computed at load, never stored:

- For each article / FAQ / variable: which processes and steps reference it.
- Shown while editing: *"used in 3 processes, 5 steps."* This is the guard
  against tuning a shared article to one context and silently breaking another.
- Also gives the handoff report: for each process, the count of adjacent steps
  whose `departmentId` differs.

---

## 8. Files

Three source files, committed to the repo, fetched by the app on load.

### `data/processes.json` — ~250KB today
```json
{ "schema": 1, "version": 7, "updated": "2026-09-20",
  "taxonomy": [], "processes": [] }
```

### `data/library.json` — ~400KB today
```json
{ "schema": 1, "version": 7, "updated": "2026-09-20",
  "articles": [], "faqs": [], "publishTabs": [] }
```

### `data/variables.json` — ~30KB today
```json
{ "schema": 1, "version": 7, "updated": "2026-09-20",
  "variables": [] }
```

Variables are separate deliberately: the file round-trips to other departments
constantly, and at 30KB you can review the entire diff by eye before
committing. That matters for the one file whose accuracy your credibility rests
on.

### `exports/FAQ.json` — generated, never hand-edited
The legacy `{ variables, tabs, departments }` shape that the existing
`FAQ.html` consumes. Committed so IT can take it as-is with zero work on their
side.

---

## 9. Load, draft and publish

### 9.1 Storage

- **Working draft: IndexedDB.** The corpus is ~570KB today and ~1.1MB at full
  coverage. localStorage would technically fit but leaves no headroom once a
  draft and a baseline coexist, and its failure mode is a silent
  `QuotaExceededError`.
- **localStorage: UI preferences only.** Last open process, sidebar state,
  card detail level.

### 9.2 Load sequence

The app always fetches the three live files, then compares each one's `version`
against the draft's recorded `baseVersions`.

| Condition | Behaviour |
|---|---|
| No local draft | Load live. |
| Draft base == live version | Load draft silently. Pill: *"local draft · 12 changes"*. |
| Live version > draft base | Do not choose. Show a bar: *"Published content updated 3 Oct. Your draft is from 28 Sep."* → **Keep mine / Take published / Compare**. |

Without this, a stale local draft silently wins forever and can overwrite newer
repo content on the next export. It is the one failure mode that would actually
lose work.

*As built:* **Compare** became **Review and merge**. The draft stores a copy of
the published files it started from (its base), so the merge works item by
item: a change on one side only is taken automatically, a change on both is
the user's choice. **Keep mine** adopts the newer version numbers, so the bar
does not return and the next export supersedes the published files cleanly.

Fetches use a cache-buster, since GitHub Pages responses are cached and a
just-committed update would otherwise appear not to have landed.

### 9.3 Publish

One button: **Export for GitHub**. Downloads all four files, named exactly as
they sit in the repo, each with `version` incremented and `updated` stamped.
Drag into the repo, commit. The app then advances the draft's `baseVersions` so
the next load compares cleanly.

---

## 10. Exports

Principle: **where a human could read it, offer an HTML wrapper too.** The
wrapper is a self-contained page with the data embedded — the
`__FAQ_EMBED__` technique already used by the current FAQ Editor. It opens by
double-click, needs no server, and survives being emailed.

| Scope | JSON | HTML wrapper | Other |
|---|---|---|---|
| Whole corpus | 3 source files | Read-only browser of everything | — |
| One process | ✓ | Map + steps + attached content, printable | SVG |
| One department | ✓ | Same, all processes within | — |
| One article | ✓ | Styled single page | — |
| FAQ set | legacy `FAQ.json` | Single-file `FAQ.html` preview | — |
| Variables, one owner | ✓ | Email-friendly verification sheet | Plain text |
| Issues register | ✓ | Report for the consultants | CSV |
| Coverage report | ✓ | Status by department, handoff counts | — |

Public exports apply the `internal` flag: internal articles omitted, internal
variables redacted.

SVG export bakes variable values at export time, since an SVG cannot resolve
anything at view time.

---

## 11. Migration from existing content

| Source | Count | Becomes |
|---|---|---|
| `CustomerService.html` SECTIONS leaf nodes | 112 | Processes |
| `CustomerService.html` CONTEXT_NODES | 37 | Articles, `audience: internal` |
| `CustomerService.html` triage decisions | 18 | Sub-department groupings, or decision steps |
| `FAQ.json` tabs | 14 | `publishTabs` |
| `FAQ.json` items | 166 | FAQs with `publish.tabId` |
| `FAQ.json` group headings | 31 | `publish.groupTitle` on the following item |
| `FAQ.json` variables | 129 | Variables, `status: "pending"` |

Decomposing a CustomerService node body:

- numbered lists → `sop`
- `<i>"…"</i>` passages → `script`
- `[ ]` lines → `checks`
- 📌 links → `articleRefs`, link targets, and variable candidates
- ⚠️ passages → an `issue`, or a warning block retained in `sop`

**Sequencing.** Import `FAQ.json` first: the schema is already close, it
migrates nearly mechanically, and it gives a populated app on day one. Then
migrate CustomerService process by process — this is a rewrite, not a parse,
and at ~20–30 minutes per node it is 40–55 hours of work. The app is roughly
20% of total effort; migration is the rest.

### 11.1 Terminology migration

Content written over the last 12 months carries retired terminology. Migration
converts these to variables rather than find-and-replacing them, so the next
change is a single edit.

| Retired | Current | Occurrences | Scope of change |
|---|---|---|---|
| Merit | CRM | 72 | System name **and** workflow |
| Cleanaway Live Collections | Echo | 1 | System name only |

**Merit → CRM.** Wherever a node body says "Lodge Merit", "Merit #" or
"Merit Req ID", the system name becomes
`<span class="faq-var" data-var="var_sys_requests">CRM</span>`. The surrounding
phrasing is then rewritten, because the workflow changed too:

> The CRM issues a **request ID** and offers to send it to the customer by SMS
> or email. **SMS is the default.**

So a lodgement step's `completionTrigger` becomes *"Request logged in the CRM
and the request ID sent to the customer by SMS"*, and its `script` covers
confirming the customer's mobile number rather than reading out a reference.
Any step that captures contact details now needs the mobile number treated as
required, not optional — that is a real change to the entry steps, not a
rename.

Still to confirm: whether the keyword-driven lodgement flow carried over from
Merit. Until answered, affected processes carry an `issue` so they surface in
the register rather than going out wrong.

**Cleanaway Live Collections → Echo.** A single reference, and a name change
only. Critically, this must **not** be applied to the other 26 uses of
"Cleanaway" — see §6.6.

---

## 12. Decisions

Resolved during design. Recorded so they are not relitigated.

| # | Question | Decision |
|---|---|---|
| 1 | App and repo name | "Process Hub" stands as a working title. |
| 2 | Do public FAQ answers and internal scripts share text? | No shared text and no rule against it either. Copy a convenient phrase across when it genuinely fits; do not build transclusion or enforce divergence. |
| 3 | Can an FAQ answer transclude part of an article? | No. Cross-link instead. |
| 4 | Does a step need its own `status`? | No. Process-level `status` plus the issues register is enough. |
| 5 | Seeding the taxonomy | Build from the current 22 sections, fully editable afterwards. The existing categories are acknowledged as rough and are a starting point, not a structure to preserve. |
| 6 | First exemplar set | Building, Revenue, Waste and Planning. See §13. |

---

## 13. Exemplar set

Four departments, drawn from the richest existing content. 46 candidate
processes exist across these four; the ~24 below are the most complete and
carry the most structure (numbered procedures, checklists, scripts, reference
links and background articles already present).

**Lead with `PlanSTA` — Short-Term Accommodation.** At 5.1KB it is the richest
node in the corpus, and it crosses **four departments in a single process**:
Planning approval → Building reclassification (Class 1a → 1b) → Local Laws
permit → Revenue rates category change. The content itself notes that customers
are routinely blindsided by the building reclassification. A map showing four
handoffs and a customer surprise at the end is the single best demonstration of
why this work matters.

### Planning (7)
`PlanSTA` · `PlanHomeBiz` · `PlanSubdivide` · `PlanObjection` ·
`PlanPreLodge` · `PlanSecondDwelling` · `PlanProcess`

### Building (8)
`BuildingNew` · `BuildingPlans` · `BuildingOverwhelmed` · `BuildingCosts` ·
`BuildingTempHome` · `BuildingExtensions` · `BuildingInspec` · `PlumbOSSF`

### Waste (5)
`WasteFacilities` · `WasteTradePollution` · `WasteDumping` ·
`WasteNewService` · `WasteRecycleMate`

### Revenue (4)
`RatesSale` · `RatesAdmin` · `RatesBalPay` · `RatesPayAgree`

Four of these — `RatesAdmin`, `RatesBalPay`, `RatesPayAgree` and the waste
nodes — reference Merit heavily and will need the terminology pass in §11.1
before they are shown to anyone.

---

## 14. Remaining open questions

1. Does the keyword-driven lodgement flow carry over from Merit to the CRM, or
   does the CRM categorise requests differently? Affects the `sop` on every
   lodgement step.
2. Are there further retired systems or terms beyond Merit and Cleanaway Live
   Collections? Two have surfaced in conversation rather than by audit, which
   suggests there are more.
3. Does the SMS default change anything upstream — is a mobile number now
   mandatory at the entry step, and what is the fallback when a customer has
   no mobile?
