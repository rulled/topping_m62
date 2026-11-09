# Comprehension review — `docs/PLAN.md`

Reviewer: Comprehension Goldfish (naive reader, no project history)
Document audited: `docs/PLAN.md`, whole file (218 lines)
Baseline read for contrast: `docs/STATUS.md`, `docs/TODO-HANDS.md`

---

## What this proposes

PLAN.md lays out four remaining work fronts. First (and top priority), remove the
backend's dependency on the MCC desktop app's **window** by replacing UI automation
with direct HID frames for input EQ, compressor, and possibly reverb; this is claimed
to take autonomy from 61% to ~80% (no MCC *installed*) and from 80% to 100% (no MCC
*running*). Second, stop depending on MCC's INI files by keeping the project's own
JSON state in `%APPDATA%\m62\`. Third, build the frontend, starting with volume and
settings screens, under five stated constraints. Fourth, firmware reverse-engineering
as a later, high-risk track (10%). The document closes with a pre-flight checklist
(close MCC from the tray), four methodological rules learned from past mistakes, and a
five-item priority list for the next day.

## How the existing system works, per this document

The backend is an HTTP+WS server with "50 путей" that mostly talks to the device over
HID. Of the routes measured, 11 get their effect by driving MCC's GUI
(`eq-control.js`, `comp-control.js`) and therefore need MCC running, and separately 11
routes read/write MCC's INI files under
`C:\Program Files\TOPPING Pro\M Control Center\Workspace\M62`, so they need MCC
installed. Direct writes to the device only take effect inside a four-frame "bracket"
that begins `0x11:0x20 = 1` and ends `0x11:0x20 = 0` followed by `0x11:0x26 = 1`.
Reading back in the same session returns cached values, so a reconnect is required;
a running MCC rolls back writes; and `state-check.js`/`modes.js` recently duplicated
mode-detection logic and disagreed.

---

## Findings

### 1. Severity: Blocker

**Affected Scope:** §1.1 "Что сделать", step 1 (lines 48–49); interacts with §6
(lines 182–190) and §1.3 (lines 84–88).

**Discrepancy Description & Rationale:**
The very first action of the highest-priority work item cannot be set up from the
text. Step 1 says to repeat experiment B "на чистом устройстве (MCC закрыт
ПОЛНОСТЬЮ, не в трее)" and explains that "в прошлый раз был Live-режим, а тест писал
в `0x91`". The author is telling the reader that the previous run's **mode** was a
problem, but never states which mode the corrected run must use, nor how to establish
or verify that mode. §6 declares the canonical end-of-day state to be
"устройство в **Live streaming**", which is the same condition §1.1 calls suspect, so
the two sections point at different device states with no reconciliation. §1.3
separately requires Live or Mobile for `0x44`, so the reader cannot tell whether the
EQ test needs a *different* mode than the reverb test, and if so which. A reader
following the numbered steps literally can perform the experiment in a state the
document itself considers invalid, producing exactly the class of false negative §7.3
warns about.

### 2. Severity: Blocker

**Affected Scope:** §1.4 "Итог по этому блоку" (lines 93–103); §1.1 "Выигрыш"
(line 59); §1.2 "Выигрыш" (line 76); §1.3 "Выигрыш" (line 90).

**Discrepancy Description & Rationale:**
The headline projection contradicts the document's own subtotals, and the three
routes that remain unaddressed are never named.

The section states 11 routes currently need a running MCC. Its own gains are 4
(§1.1, "4 маршрута из 11"), then 2 more (§1.2, "всего станет 5 из 11" — consistent
with 11 − 4 − 2 = 5), then 2 more (§1.3). That leaves **3 of 11** requiring a running
MCC. §1.4 then claims "стало: ~80% без MCC, **100% без запущенного**" — i.e. zero
remaining — and line 103 concludes "а запущенным — не нужен вообще". Both statements
are false under the document's own arithmetic unless the other three routes are also
handled, and no section handles them. The three are presumably the mode switch,
INI-apply (which restarts MCC by definition), and the synthetic MCC click, but PLAN
never says so; a reader cannot even check which routes are still blocking the stated
goal.

Compounding this, line 103 reuses the numeral 11 for a *different* set: "MCC нужен
только для чтения/записи своих INI-файлов (11 маршрутов)". Two distinct sets of
eleven (UI-dependent vs. INI-file-dependent) are referred to with the same bare number
in adjacent sentences, so the sentence cannot be checked and the reader cannot tell
whether 11 is a coincidence or a conflation.

**Why this blocks action:** §1 is titled "снять зависимость от UI MCC" and the
priority list makes items 2–4 contingent on it. With "MCC never needs to be running"
as the completion criterion, the reader cannot know when §1 is done, and — per the
document itself — it cannot be done by executing 1.1–1.3.

### 3. Severity: Major

**Affected Scope:** "Где мы сейчас" table, lines 13–15; §1.4 lines 95–103.

**Discrepancy Description & Rationale:**
Two incompatible denominators are presented as one metric, and none of the percentages
is reproducible from the document.

Line 13 states the backend has "**50 путей**". Line 15 then reports "**61%** без MCC"
and "**80%** без запущенного". 61% of 50 routes is 30.5 — not a whole number of
routes — so the percentage cannot be computed from the base stated one table row
above; it only works on a base of 56 routes (34/56 = 60.7%), and 56 appears nowhere in
PLAN. The same holds for 80%: 45/56 = 80.4%, but 34/56 grown by the 8 routes §1.1–1.3
actually promise is 42/56 = 75%. So "~80%" is not derivable from anything the document
says, while a reader doing the arithmetic gets 75%. The derivation is never shown, so
the reader must either trust an unstated base or quietly recompute and get a different
number.

### 4. Severity: Major

**Affected Scope:** §1.1 "Что известно" and the frame sequence (lines 28–44); §1.2
step 1 (line 72); §1.3 (lines 87–88).

**Discrepancy Description & Rationale:**
"Брекет" is the central mechanism of the whole first section and is never defined.
The document shows four lines —

```
0x11:0x20 = 1
0x91:0x03 = 3
0x11:0x20 = 0
0x11:0x26 = 1
```

— and then treats "внутри брекета" as an established term. A fresh reader cannot tell:
whether `0x11:0x20` opens/closes a transaction or just sets a mode flag; why
`0x11:0x26 = 1` follows the close and whether it is mandatory or a "commit"; whether
it must be repeated per parameter or once per batch; whether the sequence is idempotent
if a write fails midway; or whether the `0x11:0x26` frame is the "periodic ANNOUNCE"
that the sibling docs treat as mandatory for `0xa1..0xaa`. No link to `PROTOCOL.md` or
to `research/NOTES.md` is given for the frame model, although the document cites
"§123 в NOTES.md" without a path (line 64). Without this the reader can only copy the
literal sequence and hope.

The same gap makes experiment C uninterpretable: "запись + `0x11:0x05` (save) ->
**прервано ошибкой записи**" (line 43). It is not stated whether the "error" was the
device rejecting the save, a crash/exception in the probing script, or a timeout. C is
the only evidence about saving, and the conclusion drawn from it is not supported by
the description.

### 5. Severity: Major

**Affected Scope:** §1.1 step 2 ("Проверить все пять полей полосы", line 50) and step
3 ("Проверить обе полосы каждого из четырёх блоков", line 52); example frame
`send(0x91, 0x03, v)` (line 28).

**Discrepancy Description & Rationale:**
The parameter-addressing model is never stated, so the test matrix cannot be built.
The document says a band has five fields (enable, type, gain, freq, Q); it says each of
the four blocks `0x91..0x94` has "обе полосы"; and its only concrete example writes
`0x91` at index `0x03`. Five fields × two bands would need ten indices, which suggests
indices `0x01..0x05` are one band and `0x06..0x0a` the other — but the document never
says this, never says whether `0x03` in the example means "gain of band 1" or "the
third tag", and never reconciles "two bands per block" with the 40 EQ tags
(`0x91..0x94 × 0x01..0x0a`) that the baseline counts. The reader cannot tell whether
the work item covers 8 parameters or 40, and therefore cannot judge whether "Повторить
опыт B" (one write) is evidence for the whole conversion.

### 6. Severity: Major

**Affected Scope:** §2 "Отвязаться от установленного MCC" (lines 107–121).

**Discrepancy Description & Rationale:**
The section offers "Варианты" that are not mutually exclusive, gives no recommendation
or decision criterion, and leaves the resulting behavior of the 11 routes undefined.
"Своё хранилище" (write JSON in `%APPDATA%\m62\`) and "Экспорт/импорт" (read MCC's INI
for migration) are complements — the second bullet even says "читать INI MCC (для
миграции)" — yet they are presented as alternatives, so a reader choosing one would
implement half of what the author describes. Nothing says whether the 11 existing
routes are removed, rewritten against the new store, or dual-written; nothing says
whether `/api/workspace/apply` (which edits INI and restarts MCC) survives, which
matters because §1.4 still counts on 11 INI routes to explain what MCC is for.

The premise is also asserted without the missing link: "Микшер и loopback не читаются
из устройства вообще, значит своя модель состояния — не костыль, а необходимость."
The document never says how the mixer is *written* today if it cannot be read back —
presumably from MCC's INI, but the reader has to supply that step. Likewise "не нужно
угадывать" (line 121) names no guessing that is currently happening.

### 7. Severity: Nit

**Affected Scope:** §5, row "Порядок инициализации" (line 176); §1.4 line 99.

**Discrepancy Description & Rationale:** "нужно ли что-то кроме handshake для полного
дампа во всех режимах" and "стало: ~80%" depend on a notion of a complete dump that is
never quantified in this document; "handshake" is named but not described here (no
link). A reader cannot tell what a full dump contains or how to detect one, so §5's
last open question is not actionable as written.

### 8. Severity: Nit

**Affected Scope:** Header, line 3; §1.2 line 64.

**Discrepancy Description & Rationale:** "по итогам **раунда 118**" and "**§123** в
NOTES.md" are unheralded project artifacts. What a "раунд" is (a day, a probing
session, a reverse-engineering iteration) is never defined, and its unit affects how
"Актуально на 2026-11-08" should be read. `NOTES.md` is cited by section number with
no path or link (the path `research/NOTES.md` appears only in the baseline docs), so
the reader cannot reach the evidence.

### 9. Severity: Nit

**Affected Scope:** §6, line 190.

**Discrepancy Description & Rationale:** "приходит **~30 тегов вместо 177**" is a
quantitative diagnostic with no unit and no baseline in this document — 177 of what
(total tags in a full handshake dump?), and is 30 a symptom of "MCC holds the HID
stream"? The baseline gives two other numbers for the same phenomenon (44 vs. 96–102
parameters), so a reader who compares them sees a third unexplained count and cannot
use this figure to decide whether the device is in a clean state before measuring.

### 10. Severity: Nit

**Affected Scope:** §4, lines 155–159.

**Discrepancy Description & Rationale:** "тот самый «суммарный режим всех трёх», о
котором спрашивал **DEISU**" introduces an undefined actor and an undefined feature.
A fresh reader cannot tell whether DEISU is a person, a user, or an organization, nor
which "трёх" are meant (three device modes? three mixer buses?). The entire
justification for the firmware track rests on this request, and neither term is
recoverable from the document.

### 11. Severity: Nit

**Affected Scope:** §4, line 163.

**Discrepancy Description & Rationale:** "Начинать только когда есть чем
восстанавливать (DFU-режим, дамп рабочей прошивки)" states a precondition but not
whether it is currently met or how to establish it. The baseline says the firmware
container is still packed, so a reader cannot tell whether a working dump exists to
restore from, or whether DFU is merely assumed available. As written the precondition
reads as satisfied when it may be the main open risk.

### 12. Severity: Nit

**Affected Scope:** §3 bullet "Запись применяется отложенно" (lines 141–142); §3's
links (lines 128–129).

**Discrepancy Description & Rationale:** Two polish items with one cause — the
frontend contract is asserted rather than specified. "Не ждать ACK, оптимистичное
обновление экрана корректно" gives no bound and no failure path; §1.3 itself concedes
a write may never apply and §7.1 measured a 60-second non-application with MCC
running, so a frontend implementer needs to know how a silently dropped write is
eventually detected and reconciled. Also, the links are written as
`../docs/FOR-DESIGNER.md` and `../docs/API.md` from a file that is itself in `docs/`;
the `../docs/` prefix is redundant and differs from the sibling-document link style,
so a reader resolving links from another location gets a needlessly fragile path.
