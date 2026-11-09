# Goldfish Review Report

**Target:** `docs/PLAN.md` · **Depth:** `quick` · **Date:** 2026-11-09

## Reviewer Status

| Reviewer | Status | Blocker | Major | Nit | Report |
| --- | --- | --- | --- | --- | --- |
| `zoom_out` | completed | 1 | 6 | 4 | `zoom_out.md` |
| `design_critic` | completed | 1 | 6 | 5 | `design_critic.md` |
| `comprehension` | completed | 2 | 4 | 6 | `comprehension.md` |

All three reviewers ran. Totals: **4 Blocker, 16 Major, 15 Nit**.
Cross-lens duplicates merged below; the count above is per-reviewer raw.

## Comprehension paraphrase

The naive reader took the document to propose four work fronts. First, remove the
backend's dependency on MCC's **window** by replacing UI automation with direct HID
frames for input EQ, compressor and possibly reverb, claimed to raise autonomy from
61% to ~80% (MCC not installed) and from 80% to 100% (MCC not running). Second, stop
depending on MCC's INI files by keeping own JSON state in `%APPDATA%\m62\`. Third,
build the frontend starting with volume and settings. Fourth, firmware reverse
engineering as a later high-risk track.

As it understood the existing system: the backend is HTTP+WS with "50 путей"; 11
routes drive MCC's GUI and need it running, separately 11 routes read/write MCC INI
and need it installed. Direct writes only take effect inside a four-frame "bracket"
(`0x11:0x20 = 1` … `0x11:0x20 = 0`, then `0x11:0x26 = 1`). Reading back in the same
session returns cached values so a reconnect is required; a running MCC rolls back
writes.

What it could not follow: which mode the retest must run in, what a "брекет"
actually does, how a band's five fields map to indices, and why 61%/80% cannot be
recomputed from the 50 paths stated one row above.

---

## Prioritized Findings (Blockers → Major → Nits)

### §1.3 targets a block `EFFECTS.md` identifies as noise reduction, not reverb — Severity: Blocker
* **Reviewer lens:** `zoom_out` (also raised by: `design_critic` M2 via `GET /api/reverb`)
* **Affected scope:** §1.3 (L78–L91), §5 (L174)
* **Discrepancy:** §1.3 instructs writing `0x44:0x0b` as "reverb type" and §5 lists
  `0x44:0x08/0x0a/0x0b/0x0f` as "room, decay, width". `docs/EFFECTS.md` says the
  opposite under a heading "Семейство 0x44 — это NC, а не «реверб»", with a table
  proving it by controlled experiment: `0x44:06` = NC level (35→40→35 via dial),
  `0x44:07` = NC type (NC1=15, NC2=30, bypass=0), `0x44:09` = NC code (NC1=1), and
  `0x44:08/0x0a/0x0b/0x0f` explicitly "смысл не установлен". Reverb is a separate UI
  object `Effect_Reverb` with `pushButtonReverbStudio/Live/Hall`, `dialRoom`,
  `dialWidth`, `dialDecay`.
* **Rationale & recommendation:** as written the experiment measures writability of
  the NC block. If it succeeds, the plan builds a reverb API that writes noise
  reduction. If it fails, the fallback "оставить UI-путь как единственный" records a
  conclusion about a block that was never tested. Fix: first build the reverb tag map
  by capture while moving `dialRoom`/`dialWidth`/`dialDecay` — the method EFFECTS.md
  already used for NC — then decide whether a write experiment is worth the time.
  The document also never names a single candidate HID tag for reverb, so
  "пишется ли реверб вообще" has no executable test in it.

### §1.1 asserts a negative that `NOTES.md` §123 contradicts field by field — Severity: Blocker
* **Reviewer lens:** `zoom_out` M1 (also raised by: `comprehension` §4, `design_critic` M5)
* **Affected scope:** §1.1 L28–L30, L38–L52
* **Discrepancy:** "Запись `send(0x91, 0x03, v)` напрямую НЕ применяется, но
  ПРИМЕНЯЕТСЯ внутри брекета" is stated as fact. `research/NOTES.md` §123.1 records
  the opposite: with MCC closed, `0x91:01` 0→1, `0x91:02` 1→2, `0x91:03` 0→5,
  `0x91:04` 632→1000, `0x91:05` 7000→10000 — all "принято". Verified: that test
  (`src/tools/verify-eq-comp-writes.js`) writes with a bare `w(t.g, t.p, t.val)`
  after handshake and **no `PP_BULK_BEGIN`**. The only support for the plan's negative
  is the later `eq-write-strategies.js` run, which the plan itself declares suspect
  two lines later ("в прошлый раз был Live-режим"). The section carries both
  positions at once.
* **Rationale & recommendation:** the reader is sent to re-run field by field an
  experiment that §123 already completed. State which measurement is believed and
  why, or run the discriminating comparison first (direct vs bracket, fresh session,
  dump window long enough to see the tag). If §123 holds, the implementation shrinks
  from "add a bracket write path" to "call `transport.send` instead of UI clicks".

### §1.2 inverts its own evidence: §123's compressor result used plain writes — Severity: Blocker
* **Reviewer lens:** `zoom_out` M1
* **Affected scope:** §1.2 L64–L68
* **Discrepancy:** The plan cites §123 ("компрессор пишется через HID (8/8)") then
  infers "Вероятно, та же история, что с EQ: нужен брекет". But §123's compressor
  result came from the same bracket-less loop — `verify-eq-comp-writes.js` writes
  `0x46:*` the same way. The section cites the proof that direct writes work and
  derives from it that a bracket is required.
* **Rationale & recommendation:** this is the inverse error of the Blocker above and
  sits at the same scope: §1.1 says direct writes fail, §1.2 says they work. The two
  halves of the day's highest-value work rest on contradictory premises. One
  discriminating experiment per family settles both.

### "100% без запущенного" is false under the plan's own arithmetic — Severity: Blocker
* **Reviewer lens:** `comprehension` §2 (also raised by: `zoom_out` M2, `design_critic` M1/M2)
* **Affected scope:** §1.4 (L93–L103), with the per-task claims at L59, L76, L90
* **Discrepancy:** §1.4 claims "стало: ~80% без MCC, 100% без запущенного" and
  concludes "а запущенным — не нужен вообще". The plan's own subtotals are 4 (§1.1),
  then 2 (§1.2, "станет 5 из 11"), then 2 (§1.3) — leaving **3 of 11** still
  requiring a launched MCC. Those three are never named. Additionally at least three
  GET routes still guard on `isEqWindowOpen()` — verified in `src/server.js` at lines
  790, 812, 862, 933, 977 — and §1.1 step 5 is silent on them. `GET /api/eq/types`
  reads filter types out of an open popup, which no write conversion touches.
* **Rationale & recommendation:** state the target honestly (75%, with the 3 routes
  undecided) or decide those three explicitly. The two sets of eleven (UI-dependent
  vs file-dependent) are referred to with the same bare numeral in adjacent
  sentences; name them apart.

### "~80% без MCC" is the pre-existing 80% figure relabelled — Severity: Major
* **Reviewer lens:** `design_critic` M1 (also raised by: `zoom_out` M2, `comprehension` §3)
* **Affected scope:** L13, L15, L59, L76, L90, L95–L103
* **Discrepancy:** From the plan's own baseline (56 routes: 34 pure HID / 11 file /
  11 UI), §1.1–§1.3 convert 8 UI routes → 42 pure HID = **75%**, not ~80%. 80%
  (45/56) needs the 11 file routes gone too, which §1.4 and §2 explicitly keep. The
  "~80%" is the existing "80% без запущенного" figure reused under a new label.
  Separately, L13 says "50 путей" while the percentages only work on a base of 56;
  61% of 50 is not a whole number of routes. The plan never reconciles the two
  denominators.
* **Rationale & recommendation:** fix the denominator once (state whether "маршрут"
  and "путь" are the same unit, give both counts), then show the projected state as
  arithmetic: 34/11/11 → after each sub-task → final. Delete "~80%" or support it.

### The autonomy metric is a string scan that mis-buckets the routes §1.2 targets — Severity: Major
* **Reviewer lens:** `zoom_out` M3
* **Affected scope:** L15, §1.2 (L62–L76), §1.4
* **Discrepancy:** `src/tools/autonomy-report.js` regex-scans `server.js` for marker
  substrings. Verified: it looks for `'compressor.open'` etc., but the routes call
  `comp.openCompWindow()` — no match. So it reports `POST /api/compressor/open` and
  `/close` as **pure HID** although they drive the MCC window (verified in
  `src/server.js`: `comp.openCompWindow()`), and puts `/param` and `/switch` in the
  **file** bucket via `workspace.invalidate`, not the UI bucket. §1.2's "2 маршрута"
  therefore refers to routes the instrument does not count as UI-dependent. Worse,
  converting a write to HID leaves the route in the file bucket because it still
  calls `workspace.invalidate`, so the metric would show zero improvement for the
  work billed as the main gain.
* **Rationale & recommendation:** replace the proxy with a behavioural check per
  capability: "EQ band edit works with MCC uninstalled", "compressor edit works with
  MCC uninstalled". Those cannot be gamed by renaming a function.

### Read path and state ownership are never decided — Severity: Major
* **Reviewer lens:** `zoom_out` M4
* **Affected scope:** §1.1 L53–L57, §1.2 L70–L74, §1.4, §2
* **Discrepancy:** The plan converts writes only. `/api/eq/band` computes `before`
  and `after` through `readEqBandsFromWorkspace()` — verified in `src/server.js`,
  the function calls `workspace.describe()`. With MCC uninstalled those reads fail no
  matter how the write travels, so §2's goal is not reached by the described edits.
  The plan also never says which source is canonical after conversion: if the INI does
  not follow a HID write, `/api/eq/band` reports a stale `after` and the route appears
  to reject a write that succeeded — the exact false-negative pattern §7 rules 2 and 3
  were written to prevent.
* **Rationale & recommendation:** state per capability: "state lives in X; the INI is
  imported once at migration and never read at runtime" (or the reverse, with reason).
  Without that, §1 and §2 are two competing state models.

### §2 proposes a second full-state store beside the one that already exists — Severity: Major
* **Reviewer lens:** `zoom_out` M5 (also raised by: `comprehension` §6, `design_critic` B1)
* **Affected scope:** §2 (L107–L121), interacting with §7.4
* **Discrepancy:** §2 proposes JSON in `%APPDATA%\m62\`. `src/snapshots.js` already is
  a full-state JSON store: `captureSnapshot()` collects HID cache plus workspace
  sections (inputs, mixer, eq, loopback, outputs, ducking, effects, compressor) into
  one JSON, with `listSnapshots`, `getSnapshot`, `diffSnapshots`, `applySnapshot()`.
  The plan never says whether the new store *is* this one, *replaces* it, or sits
  beside it. Two state stores diverge silently — the same failure §7.4 records one
  paragraph away about duplicated logic.
* **Rationale & recommendation:** reuse before build. Either make `snapshots.js` the
  runtime store (point its directory at `%APPDATA%`) or state why it cannot serve and
  what gets deleted. §2 should read as "one state model, one file, one writer".

### §2's "Варианты" are complements, not alternatives — Severity: Major
* **Reviewer lens:** `comprehension` §6 (also raised by: `design_critic` B1)
* **Affected scope:** §2 (L107–L121)
* **Discrepancy:** "Своё хранилище" and "Экспорт/импорт" are both adopted; the second
  even says "читать INI MCC (для миграции)". No candidate is rejected, so no rejection
  rationale exists anywhere in the file. Nothing says whether the 11 routes are
  removed, rewritten, or dual-written; nothing says whether `/api/workspace/apply`
  survives — which matters because §1.4 counts on 11 INI routes.
* **Rationale & recommendation:** give a genuinely rejected option per decision with
  the technical reason (e.g. "keep INI as source of truth — rejected because mixer
  and loopback cannot be read back from the device, so the INI cannot be validated or
  repaired").

### The mode for the primary experiments is unstated and conflicts with §6 — Severity: Major
* **Reviewer lens:** `comprehension` §1 (also raised by: `zoom_out` M6, `design_critic` M3)
* **Affected scope:** §1.1 L48–L49, §1.3 L84–L88, §6 L182–L190
* **Discrepancy:** §1.1 flags the last run as suspect because "в прошлый раз был
  Live-режим", making mode the named confound — then never states which mode to use.
  §6 says the device is left in **Live streaming**, which is also the only mode §1.3
  says can test `0x44`. A reader following §6 then §1.1 runs the retest in the exact
  condition just declared suspect.
* **Rationale & recommendation:** one precondition line per experiment: mode, MCC
  fully closed (not trayed), jack state, minimum dump window. §7 rule 3 is enforceable
  only if each experiment declares fixed conditions.

### No fallback if §1.1 or §1.2 fails — Severity: Major
* **Reviewer lens:** `design_critic` M4
* **Affected scope:** §1.1, §1.2, §1.4, priority list
* **Discrepancy:** §1.3 defines a failure branch; §1.1 and §1.2 define none. Yet the
  priority list and the §1.4 projection depend on all three succeeding.
* **Rationale & recommendation:** add a stated negative branch and time box per
  sub-task: what is written down, what state is restored, which item is picked up
  next (the frontend start is the obvious candidate — name it).

### Destructive hardware experiments have no restore or persistence procedure — Severity: Major
* **Reviewer lens:** `design_critic` M5
* **Affected scope:** §1.1, §1.2, §1.3
* **Discrepancy:** No restore step, no power-cycle persistence check, no statement of
  what happens if a bracket write leaves the device half-applied. Three specifics:
  strategy C ("прервано ошибкой записи") is recorded but never analysed; §1.1 never
  requires the reconnect check that §7 rule 2 mandates (though §1.2 and §1.3 do);
  direct HID writes with MCC closed bypass whatever the INI recorded, and the plan has
  no equivalent of the "INI восстановлен, устройство в исходном состоянии" step.
* **Rationale & recommendation:** add a "перед/после каждого опыта" protocol for
  §1.1–§1.3: snapshot affected tags, restore, verify with reconnect, record power-cycle
  persistence, state the recovery route. Resolve strategy C's failure explicitly.

### No problem statement, goals/non-goals, or completion criteria — Severity: Major
* **Reviewer lens:** `design_critic` M6
* **Affected scope:** whole file, especially L8–L17 and §3
* **Discrepancy:** What exists is a state snapshot and a task list. Nothing states the
  problem being solved (product independent of MCC, or merely reduced install
  friction?), what the plan will not attempt, or what "done" means for any item. §3
  has ordering but no acceptance criteria. §5 has no owner, criterion, or trigger.
* **Rationale & recommendation:** add a short problem statement with the user-visible
  consequence of the MCC-window dependency; explicit non-goals; a done-criterion per
  item in the form "measurement X passes under conditions Y"; and for each §5 item the
  decision it blocks.

### "Брекет" is the central mechanism and is never defined — Severity: Major
* **Reviewer lens:** `comprehension` §4
* **Affected scope:** §1.1 L28–L44, §1.2 L72, §1.3 L87–L88
* **Discrepancy:** Four lines of frames are shown, then "внутри брекета" is treated as
  established. A fresh reader cannot tell whether `0x11:0x20` opens a transaction or
  sets a mode flag; whether the trailing `0x11:0x26 = 1` is mandatory or a commit;
  whether it repeats per parameter or once per batch; whether the sequence is
  idempotent if a write fails midway; or whether that frame is the same "periodic
  ANNOUNCE" the sibling docs call mandatory for `0xa1..0xaa`. No link to
  `PROTOCOL.md`. The same gap makes experiment C uninterpretable.
* **Rationale & recommendation:** link the frame model to `docs/PROTOCOL.md` and
  state what the bracket does. Say what "ошибка записи" in strategy C was.

### The parameter-addressing model is never stated — Severity: Major
* **Reviewer lens:** `comprehension` §5
* **Affected scope:** §1.1 steps 2–3, example `send(0x91, 0x03, v)`
* **Discrepancy:** Five fields × two bands needs ten indices, suggesting `0x01..0x05`
  is one band and `0x06..0x0a` the other — but this is never said, and `0x03` in the
  example is not tied to "gain of band 1". The reader cannot tell whether the work
  item covers 8 parameters or 40, so cannot judge whether one successful write is
  evidence for the whole conversion.
* **Rationale & recommendation:** state the index layout (band 1 = `0x01..0x05`,
  band 2 = `0x06..0x0a`) and the resulting parameter count.

### Nit — L184–L190: Prof tag count used as a threshold for a Live device — Severity: Nit
* **Reviewer lens:** `zoom_out` N2 (also raised by: `design_critic` N2, `comprehension` §9)
* **Affected scope:** §6 L184–L190
* **Discrepancy:** "~30 тегов вместо 177" — 177 is the Prof figure; Live is ~100
  (`docs/EQ-HP.md` gives 100/95/177 for Live/Mobile/Prof). A reader in Live will take
  a correct ~100-tag dump for a broken one.
* **Recommendation:** one number per mode, stated next to the mode.

### Nit — documentation line count is unverifiable — Severity: Nit
* **Reviewer lens:** `zoom_out` N4
* **Affected scope:** L14
* **Discrepancy:** `docs/` holds 10 files totalling ~4185 lines; no subset yields
  ~1900, so the figure cannot be reproduced.
* **Recommendation:** cite `node src/tools/audit-docs.js` as the evidence.

### Nit — hard-coded PID in the pre-flight section — Severity: Nit
* **Reviewer lens:** `design_critic` N1
* **Affected scope:** §6 L183–L187
* **Discrepancy:** "PID 14016" is a property of one machine at one moment; a reader
  who does not find it may conclude the precondition is met. The UIPI claim is
  asserted without the command that would verify it.
* **Recommendation:** process name plus a verification command.

### Nit — self-referential doc links — Severity: Nit
* **Reviewer lens:** `design_critic` N3 (also raised by: `comprehension` §12)
* **Affected scope:** L128–L129
* **Discrepancy:** From `docs/PLAN.md`, `../docs/FOR-DESIGNER.md` resolves back into
  `docs/`; the prefix is redundant.
* **Recommendation:** use `FOR-DESIGNER.md` and `API.md`.

### Nit — script references without location — Severity: Nit
* **Reviewer lens:** `design_critic` N4
* **Affected scope:** L38, L207–L208
* **Discrepancy:** `eq-write-strategies.js`, `state-check.js`, `modes.js` are named
  without paths, so a fresh reader cannot find or re-run the evidence.
* **Recommendation:** give paths and the exact invocation for the load-bearing
  measurement.

### Nit — §5 mixes verified absences with open questions — Severity: Nit
* **Reviewer lens:** `design_critic` N5
* **Affected scope:** §5 L168–L176
* **Discrepancy:** "48V не отдаётся" and Expander are negative findings, not open
  questions; "нужно ли что-то кроме handshake" is an unbounded research question.
  None is referenced by the priority list.
* **Recommendation:** split the two, link each open question to the item it blocks.

### Nit — altitude drop: function-level edits instead of contracts — Severity: Nit
* **Reviewer lens:** `zoom_out` N1
* **Affected scope:** §1.1 step 4, §1.2 step 2
* **Discrepancy:** "переписать `src/eq-control.js`: `setEqParamTo`…" prescribes
  internal functions. The section needs the interface statement: which layer owns
  device writes, what `eq-control` may still require the window for, what a route
  returns when the window is closed.
* **Recommendation:** state contracts and data flow at plan level.

### Nit — speculative work carried as peers of the operational plan — Severity: Nit
* **Reviewer lens:** `zoom_out` N3
* **Affected scope:** §4, §5
* **Discrepancy:** §4 is explicitly speculative and correctly gated on recovery
  capability, but remains a numbered section competing for attention with §1–§3.
* **Recommendation:** park it behind an explicit trigger.

### Nit — "раунд 118" and "§123" are unheralded artifacts — Severity: Nit
* **Reviewer lens:** `comprehension` §8
* **Affected scope:** L3, L64
* **Discrepancy:** What a "раунд" is (a day, a session, an iteration) is never
  defined, and `NOTES.md` is cited by section with no path.
* **Recommendation:** define the unit once and give the path.

### Nit — DEISU and "трёх" are undefined — Severity: Nit
* **Reviewer lens:** `comprehension` §10
* **Affected scope:** §4
* **Discrepancy:** A fresh reader cannot tell whether DEISU is a person or an
  organization, nor which "трёх" are meant. The firmware justification rests on this.
* **Recommendation:** name the actor and the three things.

### Nit — firmware precondition reads as satisfied — Severity: Nit
* **Reviewer lens:** `comprehension` §11
* **Affected scope:** §4
* **Discrepancy:** "начинать только когда есть чем восстанавливать" states a
  precondition but not whether it is met or how to establish it.
* **Recommendation:** state whether a working dump and DFU path exist today.

### Nit — frontend asynchrony boundary not specified — Severity: Nit
* **Reviewer lens:** `comprehension` §12
* **Affected scope:** §3
* **Discrepancy:** "не ждать ACK, оптимистичное обновление корректно" gives no bound
  and no failure path, while §7.1 measured a 60-second non-application.
* **Recommendation:** state how a silently dropped write is eventually detected and
  reconciled.

---

## Resolution

Triage by the author context. Each finding gets exactly one label.

### CONTEST

**"§1.3 targets NC, not reverb" (Blocker 1)** — CONTEST on the premise, accept the
action. The reviewer read `docs/EFFECTS.md` correctly, and that document does say
`0x44` is NC. But the same document's "Как проверялось" section reports a snapshot of
`0x44` while the UI controls moved, and `docs/MIXER.md` + `research/NOTES.md` §131.7
record that `0x44:0x0d/0x0e` are FX meters that exist **only in Live** — which is why
`src/modes.js` now uses them as the Live/Mobile discriminator. So `0x44` is not
purely NC: it carries NC state *and* FX levels/meters. `EFFECTS.md`'s heading
overstates. The reviewer is nonetheless right that §1.3 as written cannot test reverb:
no candidate tag for reverb type/room/decay/width is named anywhere, and `0x44:0x08/
0x0a/0x0b/0x0f` are explicitly unresolved. **Action: accept the re-scoping** — build
the reverb tag map first by capture. The `EFFECTS.md` heading itself needs correcting
separately.

**"§1.1 asserts a negative §123 contradicts" (Blocker 2)** — CONTEST the framing,
accept the defect. §123's EQ writes used `SNAPSHOT_MS = 7000` in a 26-second-budget
regime, i.e. the same too-short-snapshot method error the project already documented
in §130. So §123 is not clean counter-evidence; it may be the same false positive
mirrored. But the reviewer is right that the plan states "НЕ применяется" as fact
while its only support is a run it simultaneously calls suspect. **Action: accept** —
the plan must not carry both positions.

**"§1.2 inverts its own evidence" (Blocker 3)** — CONTEST. Verified: `verify-eq-comp-
writes.js` writes compressor tags with a bare write and no bracket, and §123 records
them as accepted. But that test also used the 7-second snapshot, so "accepted" may
equally be a measurement artifact. The inference is not *inverted* — it is
*unfounded in the same way as §1.1*. **Action: accept** that both must be re-tested
by one discriminating experiment.

### ESCALATE

**"No evaluation of alternatives" (design_critic Blocker 1)** — ESCALATE. The plan is
a working note for one author continuing their own project the next morning, not a
specification that others will implement. The reviewer applied the Feature
Specification Standard, which the skill's own Depth table assigns to stage 3 — but
this document is a day plan, not a feature spec. Whether it should carry an
alternatives table is the user's call: if anyone else will ever read or execute this
plan, add it; if not, it is ceremony. Not fixed.

### PROPOSE FIX

Accepted, to be applied:

1. **Re-scope §1.3** — build reverb tag map first; no write experiment until a
   candidate tag exists.
2. **Rewrite §1.1 "Что известно"** — state that §123 and `eq-write-strategies.js`
   disagree *because both used short snapshots*, and that the discriminating test is
   one run: direct write vs bracket, fresh session, 26-second window, MCC fully closed.
3. **Rewrite §1.2** the same way — no bracket hypothesis asserted from §123.
4. **Fix the arithmetic in §1.4** — 34/11/11 → 42/11/3 after the three conversions
   (75% pure HID); name the three remaining UI routes explicitly (`/api/mode`,
   `/api/workspace/apply`, `/api/mcc/click`) and the three EQ read routes that stay
   window-bound (`GET /api/eq`, `/types`, `/dials`).
5. **Fix the denominators** — say 50 paths / 56 method+path pairs once, and use one
   consistently.
6. **Replace the autonomy metric** with behavioural checks ("EQ edit works with MCC
   uninstalled"), and fix `autonomy-report.js` marker bug or drop it.
7. **Add state ownership statement** per capability in §1.4 and §2.
8. **Point §2 at `snapshots.js`** instead of a new store, or justify why not.
9. **Add per-experiment preconditions** (mode, MCC closed, jacks, dump window) to
   §1.1–§1.3.
10. **Add failure branches** for §1.1 and §1.2 with time box and named next item.
11. **Add the before/after restore protocol** and resolve strategy C.
12. **Add problem statement, non-goals, done-criteria.**
13. **Define "брекет"** with a link to `PROTOCOL.md`.
14. **State the EQ index layout** (`0x01..0x05` band 1, `0x06..0x0a` band 2).
15. **Fix §6** — process name not PID; per-mode tag counts.
16. **Fix links** — drop `../docs/` prefix.
17. **Add paths** to cited scripts.
18. **Split §5** into verified absences vs open questions.
19. **Define "раунд"**, DEISU, and the firmware precondition state.

### DECLINE

- §1.1/§1.2 function-level granularity (Nit) — the author is the implementer; naming
  the functions is faster than writing contracts.
- §4/§5 as numbered sections (Nit) — they correctly carry the "later, high risk" label.
- Frontend asynchrony bound (Nit) — there is no frontend yet; the constraint is
  recorded for when there is one.

---

## Summary

| Severity | Count |
| --- | --- |
| Blocker | 4 |
| Major | 16 |
| Nit | 15 |

Four Blockers: one mis-scoped experiment (§1.3), one internal contradiction about
whether direct HID writes work (§1.1 vs §123), one inverted inference (§1.2), and one
arithmetic claim that the plan's own numbers refute (§1.4). All three reviewers ran;
the round is not clean.

---

## Applied — 2026-11-09

User approved all 19 proposed fixes plus correcting the `EFFECTS.md` heading.
What changed:

### `docs/PLAN.md` — rewritten

- §1 no longer asserts that direct EQ writes fail. It states the contradiction
  between `research/NOTES.md` §123 and §134.8, notes that **both** used a suspect
  method (7-second snapshot / wrong mode), and defines one discriminating experiment
  with fixed conditions.
- §1.3 is re-scoped: reverb is now "build the tag map first, write later". No
  candidate tag is named because none is known.
- §1.4 has an explicit negative branch: if neither direct nor bracket writes work,
  record it and move to the frontend instead of stalling.
- Preconditions (mode, MCC closed, dump window, reconnect, jacks) are stated per
  experiment, and §7 collects them as a protocol.
- §2 now points at `src/snapshots.js` as the single state store instead of proposing
  a second one, and names the rejected alternative with its reason.
- Added: problem statement, non-goals, done-criteria, EQ index layout
  (`0x01..0x05` band 1, `0x06..0x0a` band 2, 40 parameters total), "брекет" defined
  by reference, links fixed, script paths added, §5 split into verified absences vs
  open questions.
- Removed the hard-coded PID; §8 uses process name plus a verification command and
  per-mode tag counts instead of a single 177.

### Autonomy numbers corrected — twice

The reviewers found the 61%/80% figures unreproducible. Investigating found the
metric itself was broken: `autonomy-report.js` matches substrings, so it reports
`POST /api/compressor/open` as pure HID although the route calls
`comp.openCompWindow()`.

New instrument `src/tools/autonomy-audit.js` classifies by actual function calls.
Result, which is **worse** than the number the plan carried:

| class | routes | share |
| --- | --- | --- |
| pure HID | 30 / 56 | 54% |
| needs MCC files | 9 / 56 | 16% |
| manages MCC process | 1 / 56 | 2% |
| **needs running MCC** | **16 / 56** | **29%** |

`autonomy-report.js` is kept but now prints a deprecation banner pointing at the
new tool. `docs/STATUS.md` updated with these figures and with the finding that the
dependency is not only in writes: `readEqSwitch()` calls `ensureMcc()`,
`readEqTypes()` reads an open popup, `readCompressorValues()` reads the INI.

### `docs/EFFECTS.md` — heading corrected

The section was titled "Семейство 0x44 — это NC, а не «реверб»", which the reviewer
correctly read as asserting `0x44` carries only noise reduction. `0x44` also carries
FX input levels (`0x01..05`) and FX meters (`0x0d/0x0e`, Live only — the basis of
the Live/Mobile discriminator in `src/modes.js`). Retitled and split into an
"what is actually in 0x44" table plus the decoded NC tags.

### Contest — recorded, not silently overruled

Three findings were contested on evidence:

- **"§1.3 targets NC, not reverb"** — the premise is partially wrong (`0x44` is not
  only NC, as above), but the actionable complaint was right: no reverb tag is known,
  so the experiment as written could not test reverb. Both were applied: the
  `EFFECTS.md` correction and the §1.3 re-scope.
- **"§1.1 asserts a negative §123 contradicts"** — §123's own snapshot was 7 seconds,
  which cannot see `0x91` in Prof (arrives at 18.8 s). So §123 is not clean
  counter-evidence. The defect stands anyway: the plan must not carry both positions.
- **"§1.2 inverts its own evidence"** — verified that §123's compressor writes were
  bracket-less, so "inverted" is not the right word; "unfounded in the same way as
  §1.1" is. Applied as the same fix.

### Escalated

**"No evaluation of alternatives"** (design_critic Blocker 1) — the document is a
day plan for one author, not a feature spec others will implement. Whether it needs
an alternatives table is the user's call. Not applied.

### Declined

- Function-level granularity in §1 (Nit) — the author is the implementer.
- §4/§5 as numbered sections (Nit) — they carry the "later, high risk" label.
- Frontend asynchrony bound (Nit) — no frontend exists yet; the constraint is
  recorded for when it does.

### Round status

Not clean: 4 Blocker, 16 Major were raised and addressed by rewriting the document,
but the underlying **technical** questions (does EQ write directly? does a reverb
tag exist?) remain open by design — they need device experiments, not text edits.
A re-run of the review would still flag the document as carrying unresolved
questions unless those experiments are done first.
