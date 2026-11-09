# Skeptical Architect (Zoom Out Goldfish) — REVIEW

**Reviewer:** `egm-zoom-out`
**Target:** `docs/PLAN.md` (218 lines, whole file)
**Standard:** Zoom-Out Standard (`references/standards/zoom-out-standard.md`)
**Baseline read:** `docs/STATUS.md`, `docs/TODO-HANDS.md`
**Mode:** REVIEW

Context sufficiency (§0) passes: the objective ("own M62 client independent of MCC; backend done, frontend not started; the biggest remaining reserve is MCC dependence") is stated and motivated, and a newcomer can follow the document. The findings below concern whether the proposed work solves the stated problem in the simplest way, and whether the measurements and targets it carries are true.

---

## Blocker

### B1. §1.3 aims the reverb experiment at `0x44`, which the project's own controlled experiment identifies as noise reduction, not reverb

**Severity:** Blocker
**Affected Scope:** `docs/PLAN.md` §1.3 (L78–L91) and §5 (L174).

**Finding.** §1.3 states "Теги `0x44:0x08..0x0f` читаются" and instructs: "попробовать запись `0x44:0x0b` (тип реверба) одиночным кадром и в брекете". §5 repeats the classification: "`0x44:0x08/0x0a/0x0b/0x0f` | сущности не до конца расшифрованы (room, decay, width)".

`docs/EFFECTS.md` establishes the opposite by controlled experiment. Its section heading is "Семейство 0x44 — это NC, а не «реверб»" (L33); the block is mapped as `0x44:06` = noise-reduction level, `0x44:07` = NC type/bypass (NC1=15, NC2=30, bypass=0), and the remaining tags are explicitly unresolved — "`0x44:0x08` ? всегда 0", "`0x44:0x0b` ? 1" (L42–L46). Reverb is a separate UI object, `Effect_Reverb` with `pushButtonReverbStudio/Live/Hall`, `dialRoom`, `dialWidth`, `dialDecay` (L143–L153). EFFECTS.md's practical conclusion (L90–L92) is that effect values must be **read** from HID tags while the UI is used only for **changing** them, to discover which tag means what.

Consequence. The experiment as written measures whether the **noise-reduction** block is writable. If it succeeds, the plan converts `/api/reverb` and `/api/reverb/param` to a path that writes NC — wrong and destructive. If it fails, the plan records "reverb is not writable" on evidence about a different DSP block, and §1.3's fallback ("честно зафиксировать и оставить UI-путь как единственный") locks in a conclusion the document did not test. The document never names a single candidate HID tag for reverb type/room/decay/width, so "пишется ли реверб вообще" has no executable test in it.

Note that the baseline is not clean either: `docs/TODO-HANDS.md` L67 carries the same conflation ("«реверб только файлом» | читается из HID (`0x44:0x08..0x0f`)"), while `docs/PROTOCOL.md` L362 groups the two ("**Реверб / NR** … `0x44:0x01..0x0f`"). Three project documents disagree, and the plan adopts the version contradicted by the one document that ran the experiment.

**Simplicity Rationale.** The smaller and correct scope is: first build the tag map for `Effect_Reverb` by one capture while moving `dialRoom`/`dialWidth`/`dialDecay` — the same method EFFECTS.md used for NC — and only then decide whether a write experiment is worth a day. As written, §1.3 spends a full experiment on a block whose identity is already resolved, and it is not the block it wants to test.

---

## Major

### M1. §1.1 presents a contested negative as established fact, and §1.2's hypothesis contradicts the very section it cites

**Severity:** Major
**Affected Scope:** `docs/PLAN.md` §1.1 L28–L30, L38–L52; §1.2 L64–L68.

**Finding.** L28–L29: "Запись `send(0x91, 0x03, v)` напрямую НЕ применяется, но ПРИМЕНЯЕТСЯ внутри брекета". Two problems.

*First, the record says the opposite for EQ.* `research/NOTES.md` §123.1 ("EQ И КОМПРЕССОР ПИШУТСЯ ЧЕРЕЗ HID (8/8)") lists, with MCC closed, `0x91:01` 0→1, `0x91:02` type 1→2, `0x91:03` gain 0→5, `0x91:04` freq 632→1000, `0x91:05` Q 7000→10000 — all "принято", i.e. all five fields §1.1 step 2 proposes to re-test. §123.3 attributes every earlier negative to three specific method errors, and §130.2 generalises the lesson ("«Не принято» означало «не увидели»"). The plan's only support for the negative is the later `eq-write-strategies.js` run (§134.8) — which the plan *itself* declares unreliable in the same paragraph: L48–L49 "Повторить опыт B на чистом устройстве … в прошлый раз был Live-режим". Asserting "НЕ применяется" and simultaneously calling the run suspect is contradictory; whichever reading is right, the section cannot stand as written.

*Second, §1.2 contradicts §123 about the compressor.* L64–L66 cites §123 correctly ("компрессор пишется через HID (8/8)") then infers "Вероятно, та же история, что с EQ: нужен брекет". But §123's compressor result was obtained with **plain writes, no bracket**: `src/tools/verify-eq-comp-writes.js` L198–L204 writes `w(t.g, t.p, t.val)` after the handshake and nothing else — no `PP_BULK_BEGIN`. So the plan cites the section that proves direct compressor writes work, and derives from it that a bracket is needed. The inference inverts its own evidence.

Consequence. Both halves of the day's highest-value work rest on a premise the project's own notes contradict, and the reader is sent to re-run an experiment (§1.1 step 2) that §123.2 already completed field by field.

**Simplicity Rationale.** The discriminating experiment is smaller than the planned one: one controlled comparison per family — direct write, fresh session, dump window long enough to see the tag — deciding between "direct works" and "bracket required". If §123 holds, the implementation shrinks from "add a bracket write path" to "call `transport.send` instead of UI clicks". The plan must state which measurement it believes and why, or run the discriminating test first; what it must not do is carry both positions in one document.

### M2. The projected "~80% / 100%" is not derivable from the project's own route counts, and three routes are silently left behind

**Severity:** Major
**Affected Scope:** `docs/PLAN.md` §1.4 (L93–L103), with the per-task win claims at L59, L76, L90.

**Finding.** L98–L99: "было: 61% без MCC, 80% без запущенного / стало: ~80% без MCC, 100% без запущенного".

From the document's own baseline (56 routes: 34 pure HID / 11 file-MCC / 11 UI-MCC), §1.1–§1.3 convert 4 + 2 + 2 = 8 UI routes, giving 34 + 8 = 42 pure HID = **75%**, not ~80%. 80% (45/56) is reachable only by also eliminating file-MCC routes, which §1.4 and §2 explicitly keep ("MCC нужен только для чтения/записи своих INI-файлов (11 маршрутов)"). The "~80%" is the pre-existing "80% без запущенного" figure re-used under a new label.

"100% без запущенного" is also unsupported. The UI bucket has 11 members; §1.1 step 5 frees only the four POST routes and is silent on `GET /api/eq`, `GET /api/eq/types`, `GET /api/eq/dials`, each of which still guards on `isEqWindowOpen()` (`src/server.js` L746, L790, L812). `GET /api/eq/types` reads filter types out of an open popup (`readEqTypes`), which no write conversion touches. So at least three launched-MCC-dependent routes survive the plan while the headline claims zero.

**Simplicity Rationale.** The plan's prioritisation ("самый большой оставшийся резерв", L23) rests on a gain that overstates itself by 5–25 points and omits the routes that keep the dependency alive. Either state the target honestly ("75%; the 3 EQ read routes remain undecided") and decide those three explicitly, or drop the percentage as justification and justify the work by the user-visible outcome: "EQ editing works with MCC closed".

### M3. The metric that defines success is a string-marker scan that mis-buckets the very routes §1.2 targets and cannot register the improvement the plan bills

**Severity:** Major
**Affected Scope:** `docs/PLAN.md` L15, §1.2 (L62–L76), §1.4.

**Finding.** The 61%/80% figures come from `src/tools/autonomy-report.js`, which imports nothing and regex-scans `src/server.js` for marker substrings (L24–L59). Three consequences, all verifiable by running it:

1. The compressor markers are `'compressor.open'`, `'compressor.close'`, `'compressor.param'`, `'compressor.switch'` (L45–L48), but the route bodies call `comp.openCompWindow()` / `comp.setCompressorParam()` / `comp.setCompressorSwitch()` (`src/server.js` L1079–L1155). None match. The report therefore lists `POST /api/compressor/open` and `POST /api/compressor/close` as **pure HID** although they drive the MCC window, and puts `POST /api/compressor/param` and `/switch` in the **file** bucket via `workspace.invalidate` — not in the UI bucket at all. §1.2's "2 маршрута (всего станет 5 из 11)" refers to routes the instrument does not count as UI-dependent; the claim is unverifiable against the tool and false by it.
2. `GET /api/compressor` is likewise reported pure HID, though `comp.readCompressorValues()` is workspace-file backed (server.js L1050).
3. Because classification keys on `workspace.invalidate`/`workspace.describe`, converting a write to HID frames leaves the route in the file bucket — and the plan keeps those calls (`/api/compressor/param` invalidates the INI at server.js L1126). The metric would show zero improvement for the work billed as the main gain, unless the author edits the marker list, i.e. edits the instrument to move the number.

**Simplicity Rationale.** Optimising a proxy that mislabels its target routes and can be moved by renaming a function is premature optimisation of a metric rather than of the system. The honest, simpler test is behavioural, one check per capability: "EQ band edit works with MCC uninstalled", "compressor edit works with MCC uninstalled". Those cannot be gamed and replace the whole percentage arithmetic.

### M4. Read path and state ownership are never decided; converting writes to HID does not remove the dependency the plan is removing

**Severity:** Major
**Affected Scope:** `docs/PLAN.md` §1.1 L53–L57, §1.2 L70–L74, §1.4 L95–L103, §2.

**Finding.** The plan converts *writes* only. The same routes read current state from the MCC workspace file: `/api/eq/band` computes `before` and `after` through `readEqBandsFromWorkspace()` (`src/server.js` L877, L899, L917; defined L184–L200 on `workspace.describe()`), and `/api/compressor` returns `comp.readCompressorValues()`, which is file-backed (`src/comp-control.js` L31 imports `findActiveWorkspace`/`readWorkspace`). With MCC uninstalled these fail no matter how the write is transported — so the stated goal ("снять зависимость от UI MCC", then §2 "отвязаться от установленного MCC") is not reached by the described edits.

Worse, the plan never says which source is canonical after conversion: HID tags (`0x91..0x94`, readable per §123) or the INI. If the INI does not follow a HID write, `/api/eq/band` reports `after` = the stale INI value and the route *appears* to reject a write that succeeded — precisely the false-negative pattern the document's own §7 rules 2 and 3 were written to prevent. A correct implementation of §1.1 can therefore still fail its own verification loop and send the author back to "the bracket is needed".

**Simplicity Rationale.** Minimalist data flow needs one owner per value. The plan should state per capability: "state lives in X; the INI is imported once at migration and never read at runtime" (or the reverse, with the reason). Without that decision §1 and §2 are two competing state models, and the reader cannot tell whether the win is real or the route merely changed which file it dies on.

### M5. §2 proposes a second full-state store beside the one that already exists, reproducing the duplication §7.4 itself condemns

**Severity:** Major
**Affected Scope:** `docs/PLAN.md` §2 (L107–L121), interacting with §7.4 (L206–L208).

**Finding.** §2 proposes "Держать JSON в `%APPDATA%\m62\` и не зависеть от INI", plus INI export/import for migration. `src/snapshots.js` already is a full-state JSON store: `captureSnapshot()` collects the entire HID cache plus the workspace sections (inputs, mixer, eq, loopback, outputs, ducking, effects, compressor) into one JSON (L18, L32–L88), and the module also provides `listSnapshots`, `getSnapshot`, `diffSnapshots`, and `applySnapshot()` writing both parts back (L164–L249). `workspace-service` additionally exposes `describe()`/`applyChanges()`.

The plan never says whether the new store **is** this store with a different directory, **replaces** it, or sits beside it. Introducing a second full-state model beside an existing one reproduces the failure §7.4 records one paragraph away: "логика не должна дублироваться. `state-check.js` имел свою копию определения режима, разошёлся с `modes.js` и врал на живом устройстве". Two state stores diverge exactly the same way, and here the divergence would be silent because both are "the truth" for different routes.

**Simplicity Rationale.** Reuse before build. Either make `snapshots.js` the runtime store (point `SNAP_DIR` at `%APPDATA%`, drop the "dev artifact under `research\`" assumption) or state explicitly why it cannot serve — e.g. "it is a diagnostic dump, not a transactional store" — and say what gets deleted. §2 should read as "one state model, one file, one writer", naming the owning module.

### M6. The mode the primary experiments run in is unstated and contradicts the mode the plan says the device is in; the confound it names is itself disputed

**Severity:** Major
**Affected Scope:** `docs/PLAN.md` §1.1 L48–L49, §1.3 L84–L88, §6 L182–L190.

**Finding.** §1.1 step 1 flags the last run as suspect because "в прошлый раз был Live-режим, а тест писал в `0x91`" — mode is named as the decisive confound. The replacement protocol then never states which mode to run in. §6 states the device is left in **Live streaming** (L184), which is also the only mode §1.3 says can test reverb (L84–L85). A reader following §6 and then §1.1 runs the retest in the exact condition §1.1 just declared suspect, and no line says otherwise. The document itself argues that mode is a first-class variable (§3 L136–L138: the mode changes the screen and feature set).

The confound is also unconfirmed: `research/NOTES.md` §134.8 disputes it directly — "тогда был Live-режим, а тест писал в 0x91, который в Live тоже есть — 39 тегов". So the plan makes a mode change the reason to doubt a measurement, without evidence that mode was the problem, and then omits the mode from the retest.

**Simplicity Rationale.** §7 rule 3 ("любой отрицательный результат требует контрольного опыта") is enforceable only if each experiment declares fixed conditions. One precondition line per sub-task — mode, MCC fully closed (not trayed), headphone/jack state, minimum dump window — is far cheaper than repeating the month of false negatives the document's own §7 catalogues. The current text leaves its single declared variable uncontrolled.

---

## Nit

### N1. Altitude drop: the plan prescribes edits to internal helpers instead of the contract they serve

**Severity:** Nit
**Affected Scope:** `docs/PLAN.md` §1.1 step 4 (L53–L55), §1.2 step 2 (L72–L73).

**Finding.** "переписать `src/eq-control.js`: `setEqParamTo` / `nudgeEqParam` должны слать кадры… Убрать `isEqWindowOpen` из пути записи" and "переписать `setCompressorParam` на прямые кадры" are function-level instructions. What the section actually needs is the interface statement: which layer owns device writes, what `eq-control` may still legitimately require the window for (filter-type popup, switches), and what a route returns when the window is closed. As written, a reader can satisfy the letter of the instruction while leaving the window requirement in the read path — see M4.

**Simplicity Rationale.** State contracts and data flow at plan level; leave the function split to implementation.

### N2. §6 uses a Prof-mode tag count as the health threshold for a device it says is in Live

**Severity:** Nit
**Affected Scope:** `docs/PLAN.md` L184–L190.

**Finding.** L190: "пока MCC в трее, он держит HID-поток и приходит ~30 тегов вместо 177". L184 says the device is in **Live streaming**, and `docs/EQ-HP.md` L171 gives 100 addresses for Live (177 is Prof, 95 Mobile). A reader in Live will take a correct ~100-tag dump for a broken one, or wait for blocks that the mode does not emit.

**Simplicity Rationale.** One number per mode, stated next to the mode.

### N3. §4 (firmware) and §5 are speculative work with no trigger, carried as peers of the operational plan

**Severity:** Nit
**Affected Scope:** `docs/PLAN.md` §4 (L151–L164), §5 (L168–L176).

**Finding.** §4 is explicitly speculative ("понять, можно ли добавить функции, которых нет в текущей прошивке", the DEISU "суммарный режим" question) and admits "Риск: высокий… кирпич при ошибке", correctly gating on recovery capability — but it remains a numbered section with an implied work item, competing for attention with §1–§3 that serve the project's actual purpose. §5's five open questions have no owner, cost, or trigger either.

**Simplicity Rationale.** Park speculative work outside the plan body behind an explicit trigger ("until a firmware dump and a DFU recovery path exist"), and either budget or delete each §5 question.

### N4. "Документация ~1900 строк" is an unverifiable figure

**Severity:** Nit
**Affected Scope:** `docs/PLAN.md` L14.

**Finding.** "Документация | ~1900 строк, сверяется с кодом автоматически". `docs/` currently holds 10 Markdown files totalling ~4185 lines (API.md 1536, PROTOCOL.md 604, FOR-DESIGNER.md 511, MIXER.md 509, PLAN.md 218, EFFECTS.md 184, EQ-HP.md 178, BACKEND.md 177, STATUS.md 172, TODO-HANDS.md 96). No subset is named that yields ~1900, so the figure cannot be reproduced from the tree it describes.

**Simplicity Rationale.** Cite the audit command (`node src/tools/audit-docs.js`) as the evidence instead of a hand-counted line total that will drift by the next commit.

---

## Summary

| Severity | Count |
|---|---|
| Blocker | 1 |
| Major | 6 |
| Nit | 4 |

The document's shape is right: it is high-altitude, it names the goal, the reserve, and the order of work, and it mostly avoids implementation tangents. It fails the standard structurally in two places. The largest work item (§1.1) asserts as fact a negative that the project's own §123 record contradicts field by field, and §1.2 derives a bracket hypothesis from the section that proves the opposite for the compressor. The target that justifies the work (§1.4) is arithmetic the document's own route counts do not support, and the instrument behind that arithmetic mislabels the routes it is meant to measure. §1.3 must be re-scoped before it is run: `0x44` is documented as noise reduction, so the experiment as written cannot answer the question it asks.
