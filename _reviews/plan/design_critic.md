# Design Critic — REVIEW

**Target:** `docs/PLAN.md` (218 lines, full file)
**Standard:** Feature Specification Standard
**Baseline read:** `docs/STATUS.md`, `docs/TODO-HANDS.md`
**Mode:** REVIEW

---

## Blocker

### B1. No evaluation of alternatives; the plan proposes a single path throughout

**Severity:** Blocker
**Affected Scope:** `docs/PLAN.md` — §1 (L21–L104), §2 (L107–L121), §"Приоритет на завтра" (L212–L218); standard: "The Alternatives Rule".

**Finding.** The standard fails a specification that "proposes a single path without proving that other viable designs were considered and rejected for specific, documented reasons." This document does exactly that:

- §1 commits to converting EQ, compressor, and reverb write paths from UI automation to raw HID frames. No other route to autonomy is considered or rejected: not keeping the UI path and eliminating the *launched-MCC* requirement another way (e.g. starting MCC minimized at logon as a managed dependency), not invoking MCC's own automation surface more robustly, not accepting 61%/80% and spending the effort on the frontend first. The document does not even state why the HID path is preferable to a hardened UI path — it treats "this is historical code" (L114–L116 of STATUS.md) as self-evidently sufficient.
- §2 is headed **"Варианты"** but lists two bullets — "Своё хранилище" (L114–L117) and "Экспорт/импорт" (L118–L121) — that are complementary, not alternatives. Both are adopted. There is no candidate that was actually rejected, so no rejection rationale exists anywhere in the file.
- No section states which options were considered and dismissed (e.g. reading MCC's INI through a compatibility shim; vendoring a copy of the MCC Workspace layout; a one-time migration importer plus its own store only; dropping the 11 file-dependent routes outright rather than replicating MCC state).

**Recommendation.** Add a mandatory "Рассмотренные варианты" table per major decision (§1 and §2), each row carrying: option, concrete trade-off (complexity / cost / performance / maintenance surface), and the specific technical reason it was rejected. For §2 this means at least one genuinely rejected option (e.g. "keep INI as the source of truth, ship a migration-only importer" — rejected because the mixer/loopback state cannot be read back from the device, so the INI cannot be validated or repaired). State the rejection criterion, not just the winner.

---

## Major

### M1. Autonomy percentages cannot be reproduced from the numbers the document itself gives

**Severity:** Major
**Affected Scope:** `docs/PLAN.md` L13, L15, L59, L76, L90, L95–L103, L110.

**Finding.** The headline metric of the entire plan is not derivable:

- L13 states "Бекенд (HTTP + WS) | 50 путей"; L15 quotes "61% без MCC вообще, 80% без запущенного". STATUS.md L72 states the autonomy report is computed over **56 маршрутов**, and 61% is 34/56. Against the 50 paths named in the same table, the same 34 routes are 68%. The document never reconciles "50 путей" with the 56-route denominator, and STATUS.md itself carries a third figure (48 эндпоинтов, L15). A reader who recomputes the plan's own metric from the plan's own table gets a different answer.
- §1.4 (L95–L100) claims the outcome is "~80% без MCC, 100% без запущенного". "100% без запущенного" follows: 34 pure-HID + 11 file-MCC = 45, plus the UI routes converted = 56. "~80% без MCC" does not follow from anything. If §1.1–§1.3 convert 8 UI routes, pure HID becomes 34 + 8 = 42, i.e. 75%. To reach 80% (45/56) the plan would additionally have to eliminate the 11 file-MCC routes — but §1.4 and §2 explicitly keep them ("MCC нужен только для чтения/записи своих INI-файлов"). The "~80%" is therefore the *pre-existing* "80% без запущенного" figure re-used under a different label.

**Recommendation.** Fix the denominator once (state whether "маршрут" and "путь" are the same unit, and if not, give both counts), then show the arithmetic of the projected state as a table: current 34/11/11 → after each sub-task → final. Delete "~80% без MCC" or support it with the specific additional conversion that produces it.

### M2. Two different 11-route sets are treated as one, and the route accounting is incomplete

**Severity:** Major
**Affected Scope:** `docs/PLAN.md` L59, L76, L90, L102–L103, L110.

**Finding.** The plan removes routes from "11" (§1.1: "4 маршрута из 11", §1.2: "всего станет 5 из 11", §1.3: "2 маршрута"), then §1.4 says "MCC нужен только для чтения/записи своих INI-файлов (11 маршрутов)". Those are two *different* elevens (11 UI-MCC routes vs 11 file-MCC routes, per STATUS.md L76–L79). The document never labels them apart, so the arithmetic of §1 reads as a single shrinking set of 11 that ends at "11".

The accounting is also understated relative to the baseline. STATUS.md L94–L95 lists `GET /api/eq`, `/api/eq/types`, `/api/eq/dials` as routes that "проверяют, открыто ли окно EQ", and L105 lists `GET /api/reverb` as file-dependent even though TODO-HANDS.md L67 states reverb tags are read from HID (`0x44:0x08..0x0f`). §1.1 step 5 (L56–L57) frees only the four POST routes and is silent on the three GETs; §1.3 is silent on `GET /api/reverb`. So either the win is larger than claimed (and §1.4 is wrong), or the read routes have a reason to stay window/file-bound that the plan never states.

**Recommendation.** Use two named sets with counts ("UI-зависимые: 11", "файлово-зависимые: 11") and give a per-endpoint disposition table for all 22: becomes HID / stays / undecided. For each read route that stays file-bound despite HID-readable tags, state the reason (e.g. "no HID read of the current reverb type in Live mode is confirmed").

### M3. The mode required for the primary experiment is left unstated and conflicts with the stated starting state

**Severity:** Major
**Affected Scope:** `docs/PLAN.md` L48–L49, L84–L88, L183–L190.

**Finding.** §1.1 step 1 says the previous run is suspect because "в прошлый раз был Live-режим, а тест писал в `0x91`" — i.e. mode is named as the confound. The replacement protocol then never says which mode to run in. §6 (L184) states the device is left in **Live streaming**, which is also the only mode §1.3 says can be used. A reader following §6 then §1.1 will run the retest in the exact mode the plan has just identified as the suspect condition, and no line in the document tells them otherwise. Additionally, §3 (L136–L138) states that mode changes the screen/feature set, so mode is a first-class variable here and its omission is not cosmetic.

**Recommendation.** Add an explicit per-experiment precondition line ("режим: Prof, входы 1–4, MCC закрыт, наушники подключены"), and state the mode matrix for each of §1.1/§1.2/§1.3. If the retest must be in a mode other than Live, reconcile that with §6's device state and with §1.3's Live-only requirement in one schedule.

### M4. No fallback and no decision point if §1.1 or §1.2 fails

**Severity:** Major
**Affected Scope:** `docs/PLAN.md` L46–L57, L70–L76, L95–L103, L212–L218.

**Finding.** §1.3 defines a failure branch ("Если не пишется — честно зафиксировать и оставить UI-путь", L90–L91). §1.1 and §1.2 define none. Yet the whole next-day priority list (L214–L217) and the §1.4 projection depend on all three succeeding; the document never says what is done with the day if the bracket does not apply to EQ inputs under a closed MCC, or what the frontend plan becomes if three of eleven UI routes stay MCC-bound. A plan whose first three work items are all-or-nothing experiments without a defined failure branch produces an unstructured day.

**Recommendation.** For each of §1.1/§1.2 add a stated negative-outcome branch and a time box: what is written down, what state the device/MCC INI is restored to, and which work item is picked up next (the frontend start, per L147/L218, is an obvious candidate — name it as the fallback explicitly).

### M5. Destructive hardware experiments have no restore or persistence procedure

**Severity:** Major
**Affected Scope:** `docs/PLAN.md` L40–L44, L72–L73, L88; standard: "Risks & Limits".

**Finding.** The plan's main work is writing new tag/opcode combinations to a real device across four EQ blocks, the compressor, and reverb. The document provides no restore step, no power-cycle persistence check, and no statement of what happens if a bracket write leaves the device in a half-applied state. Three concrete gaps:

- The measured strategy C — write plus `0x11:0x05` (save) — is recorded as "прервано ошибкой записи" (L43) and is never analysed. That is an unexplained failure on the write path the plan intends to build on; a fresh reader cannot tell whether save is unusable, whether the test was aborted by something else, or whether the device rejected the sequence.
- §1.1 never requires the reconnect check that the plan's own rule 2 (L201) mandates ("Чтение в той же сессии показывает кэш. Нужно переподключение"), although §1.2 and §1.3 both do ("с переподключением", L72, L88).
- Direct HID writes with MCC closed bypass whatever the MCC INI recorded. TODO-HANDS.md L27 shows "INI восстановлен, устройство в исходном состоянии" is an established practice in this project; PLAN.md carries no equivalent final step, so the next session can start from a device whose state diverges from the file the backend reads.

**Recommendation.** Add a short "перед/после каждого опыта" protocol applying to §1.1–§1.3: snapshot the affected tags, restore them afterwards, verify with reconnect, record power-cycle persistence, and state the recovery route if a bracket write wedges the device. Resolve strategy C's failure explicitly (hypothesis + the one experiment that separates it from the others).

### M6. No problem statement, no goals/non-goals, no completion criteria

**Severity:** Major
**Affected Scope:** `docs/PLAN.md` whole file, especially L8–L17 and §3 (L125–L147).

**Finding.** The standard requires Problem Statement, Goals & Non-Goals, and sufficient detail that a fresh reader can confirm the design trade-offs. What exists is a state snapshot (L10–L17) and a task list. Nothing states the actual problem being solved (is the objective a product independent of MCC, or merely reduced installation friction?), what the plan explicitly will *not* attempt, or what "done" means for any item. §3 (frontend) has ordering but no acceptance criteria, despite the backend contract being the only input a frontend author can rely on. §5 ("Мелкие открытые вопросы", L168–L176) has no owner, no decision criterion, and no trigger for when each must be resolved, so it functions as an unbounded deferral list.

**Recommendation.** Add: (a) a two-to-three line problem statement with the user-visible consequence of the current 20% MCC-window dependency; (b) explicit non-goals (e.g. firmware flashing, vendor protocol disclosure, cross-platform support) so scope creep is decidable; (c) a done-criterion per work item in the form "measurement X passes under conditions Y" — the existing "перепроверить" (L57) is not a criterion; (d) for each §5 item, the decision it blocks or the date/condition by which it must be resolved.

---

## Nit

### N1. Hard-coded PID and day-end device state in the pre-flight section

**Severity:** Nit
**Affected Scope:** `docs/PLAN.md` L183–L187.

**Finding.** "MCC висит в трее (PID 14016)" is a property of one machine at one moment; by the next session the PID is meaningless, and a reader who checks task manager and does not find 14016 may conclude the precondition is already met (or that it is a different process). The UIPI claim is asserted without the one command that would verify it.
**Recommendation.** Replace the PID with the process name and a verification command, and state the observation that proves UIPI blocking (or drop the mechanism claim).

### N2. Tag-count figures disagree with the baseline

**Severity:** Nit
**Affected Scope:** `docs/PLAN.md` L189–L190.

**Finding.** "пока MCC в трее, он держит HID-поток и приходит ~30 тегов вместо 177". STATUS.md L29 and L33 give 44 parameters without handshake and 96–102 with it; no baseline figure of 177 appears anywhere in the two context files. The warning is directionally correct but its numbers cannot be checked against the documents the reader has.
**Recommendation.** State the denominator explicitly ("тегов в полном дампе: N" with the source script), or remove the count.

### N3. Self-referential documentation links

**Severity:** Nit
**Affected Scope:** `docs/PLAN.md` L128–L129.

**Finding.** From `docs/PLAN.md`, `../docs/FOR-DESIGNER.md` resolves back into `docs/`; the `../docs/` prefix is redundant and makes the link look like it points outside the documentation folder.
**Recommendation.** Use `FOR-DESIGNER.md` and `API.md`.

### N4. Script references without location

**Severity:** Nit
**Affected Scope:** `docs/PLAN.md` L38, L207–L208.

**Finding.** `eq-write-strategies.js`, `state-check.js`, `modes.js` are named without paths, while the project's tooling is spread across `src/tools/` (325 scripts per STATUS.md) and `src/`. A fresh reader cannot find or re-run the evidence.
**Recommendation.** Give paths, and for the load-bearing measurement (`eq-write-strategies.js`) give the exact invocation and the saved output location.

### N5. §5 mixes verified absences with open questions

**Severity:** Nit
**Affected Scope:** `docs/PLAN.md` L168–L176.

**Finding.** Row 1 ("48V через HID — не отдаётся") and row 2 (Expander) are negative findings, not open questions; row 5 ("нужно ли что-то кроме handshake") is an unbounded research question. Placing them in one table suggests they carry the same decision weight, and none of them is referenced by the priority list.
**Recommendation.** Split "закрытые отрицательные результаты" from "открытые вопросы", and either link each open question to the work item it blocks or move it out of the plan.

---

**Summary:** 1 Blocker, 6 Major, 5 Nit.
