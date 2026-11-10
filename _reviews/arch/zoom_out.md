# Skeptical Architect (Zoom Out Goldfish) — REVIEW

**Reviewer:** `egm-zoom-out`
**Target:** `docs/ARCHITECTURE.md` (212 lines, whole file)
**Standard:** Zoom-Out Standard (`references/standards/zoom-out-standard.md`)
**Baseline read:** `docs/STATUS.md`, `research/WEBHID.md`; plus the code and documents the report cites as evidence (`src/tools/webhid-coverage.js`, `src/protocol.js`, `src/server.js`, `docs/PLAN.md`, `docs/BACKEND.md`, `README.md`).
**Mode:** REVIEW

Context sufficiency (§0) passes. The objective is stated and motivated in §1 — "сайт, где любой человек подключает свою M62 и управляет ею, не устанавливая M Control Center" — and the physical constraint that decides everything else is stated too: "Сервер физически не видит USB пользователя". A newcomer can follow the document and can see what decision is being asked of them. The findings below concern whether the three options are priced correctly, whether the numbers the recommendation rests on survive contact with their own source, and whether the document dissolves work the project has already paid for.

---

## Blocker

None. The document is actionable as written: §8's recommendation is traceable to its premises, and it already confines itself ("Пока это не проверено, всё остальное — теория"). Nothing in it would send a reader into a decision they cannot reverse.

---

## Major

### M1. The 85% / 15% split that the recommendation rests on does not match the tool the document cites for it

**Severity:** Major
**Affected Scope:** §2 "Вариант A" L33–L41; §3 comparison table L94–L102; §8 L195–L203.

**Finding.** L33–L34 says the coverage was "измерено `node src/tools/webhid-coverage.js` — **53 из 62 маршрутов (85%)**", and then attributes the missing 15% (L38–L41) to exactly three things: MCC profiles (files), "sample rate и buffer size — настройки USB-аудио через UIAutomation", and "открытие окон MCC — по определению".

Running that tool prints the 53 routes it counted as "МОЖНО ПОВТОРИТЬ В БРАУЗЕРЕ", and the list contains:

- `POST /api/eq/open`
- `POST /api/compressor/open`
- `POST /api/compressor/close`
- `GET /api/audio-params`
- `POST /api/audio-params`

The first three are window-opening routes (they call `openEqWindow` / `openCompWindow`); the last two are the sample-rate / buffer-size routes, which the document itself says are unreachable without UIAutomation. The tool only classifies a route as window-dependent if its body contains one of a fixed list of call names, and those routes were rewritten so that the call sits inside a `try/catch` which the tool strips before matching (`stripGuarded`), so they fell into the HID bucket. `POST /api/mcc/click` is the only route the tool actually placed in "НУЖНО ОКНО MCC".

So the 53 and the three-item 15% list cannot both be produced by the cited measurement. Either those five routes are inside the 53 — and then the 15% is not "профили + sample rate + окна", and the true browser coverage is lower than 85% — or they are outside it, and then the tool's own output contradicts the document. The same inconsistency reaches the decision: L202–L203 recommends sacrificing "sample rate — редкая настройка" on the grounds that it belongs to the unreachable remainder, while the measurement heaped it into the reachable part.

The denominator is contested too. The document's 62 comes from a regex over `src/server.js`; `docs/PLAN.md` L29 (written one day earlier, same repo) states "**50 путей** = **56 пар метод+путь**"; `docs/STATUS.md` L15 says "48 эндпоинтов". Three inventories, no reconciliation, and the headline percentage depends on which one is canonical.

**Simplicity Rationale.** The number is the entire argument for Variant A ("85% функций работают без установки — это главная ценность идеи", L196). A percentage whose numerator and denominator are both unauditable is not a measurement, it is a mood. The cheap structural fix is to stop counting routes — a route is an HTTP artifact that a browser client will not have — and count **capabilities** instead: of the user-facing things M62 can do (volumes, selectors, meters, device settings, input EQ, HP EQ, compressor, reverb, mixer, loopback, ducking, profiles, sample rate), how many does each variant deliver? That list exists in `docs/STATUS.md` as a coverage map, it is a dozen lines, and it is the thing the author actually means when writing "85% функций". As written, the decision document inherits an artifact of a heuristic script and asks the reader to believe it.

---

### M2. §4 dissolves the one module that carries the project's hard-won behaviour, and mislabels which modules are portable

**Severity:** Major
**Affected Scope:** §4 "Что меняется в бекенде при варианте A" L106–L125.

**Finding.** L115–L118: "`src/transport.js`, `src/state-store.js` и `src/workspace-service.js` в браузере не нужны", and L120–L125: "Модули `protocol.js`, `mixer-tags.js`, `eq-hid.js`, `comp-hid.js`, `reverb-hid.js`, `modes.js`, `tags.js`, `controls.js`, `settings.js` не зависят от Node и переносятся в браузер без изменений."

Three concrete errors in that inventory:

1. **`transport.js` is not "node-hid and nothing else".** Only the device handle is Node-specific. The file also contains: the batched read loop that fixed ~80% packet loss (documented in `docs/BACKEND.md` L51–L63: 262 reads/4 s before, 2048 after, settings 2/8 → 8/8); keepalive and periodic-announce scheduling (`#startKeepalive`, `KEEPALIVE_MS`); the optimistic cache update after writes, added because the device does not echo its own values (`docs/PLAN.md` §2.3 — without it the second reverb call reads a stale `Bypass` and refuses); idle-report filtering; and reconnect with exponential backoff. Every one of those is plain JS, every one is the residue of a bug that cost the project time, and every one is needed in a browser that faces the same device. Declaring the file "не нужен" and drawing no boundary between "HID handle" and "transport policy" means the browser client re-earns all five bugs. The correct decomposition is stated almost in passing but never made: the protocol core moves, and the transport is split into a policy layer (portable) plus a thin device adapter (`node-hid` today, `navigator.hid` tomorrow). That is one interface, and it is the only architectural boundary this section needs.

2. **"`protocol.js` … переносится без изменений" is false.** `src/protocol.js` L100–L105, `withReportId()`, calls `Buffer.alloc` and `Buffer.from` — `Buffer` does not exist in a browser. The frame builder itself is the thing a browser client must port first, so the claim is not cosmetic: it is the first file anyone touches.

3. **The dependent list is incomplete in the other direction.** `src/snapshots.js` imports `node:fs`, `node:path` and `./workspace.js`, and it backs five of the routes counted in the "can be reproduced in the browser" bucket (`GET/POST /api/snapshots`, `/api/snapshots/get`, `/diff`, `/apply`, `/delete`). It is absent from both lists in §4, so a reader following the document will plan the port, then discover a fs-bound module and five routes with no owner. `src/audio-params.js` (UIAutomation) is likewise only implied by "`ui-control.js` (UIAutomation)".

**Simplicity Rationale.** §4 is the section that tells the reader how much of the existing system survives, and it is the section that decides whether the browser client is a port or a rewrite. Its answer — "ядро протокола переносится, обвязка — нет" — is the right instinct at the wrong granularity: it splits by file rather than by responsibility, so it throws away the portable half of `transport.js` and keeps a non-portable `protocol.js`. The simple version of the same rule is one sentence: *anything that decides when and what to send is portable; anything that opens a device or touches a filesystem is not.* Stated that way, the module list falls out correctly and `snapshots.js` cannot be forgotten.

---

### M3. §5 reopens a question the project has already closed, and puts it on the critical path of every variant

**Severity:** Major
**Affected Scope:** §5 L135–L145, specifically the table row L141.

**Finding.** The table "Осталось отреверсить (не зависит от варианта)" lists:

> `| Expander (Expander_IN1/IN2) | есть в строках MCC, в дампе не встречались |`

and L144–L145 promotes it: "Первые три [ducking/loopback, sample rate, **Expander**] нужны при любом варианте — они про устройство, а не про способ связи."

The project has already filed this as a closed negative. `docs/PLAN.md` L342, under the heading "**Закрытые отрицательные результаты**": "Expander (`Expander_IN1/IN2`) — строки есть в бинарнике MCC, в UI и дампах не встречались. **Вероятно, не реализовано в прошивке**". `docs/EFFECTS.md` reaches the same conclusion ("есть в строках exe, но в UI не найден"), and `docs/TODO-HANDS.md` L46 says "Перепроверять не обязательно". ARCHITECTURE restates the same observation ("в дампе не встречались") and then draws the opposite conclusion from it: it turns a "probably not in the firmware" into an open reverse-engineering task that blocks all three variants.

Nor does the document name a consumer. Nothing in §1, §2 or §8 needs an expander: the objective is "управлять своей M62", and no M62 feature the document enumerates depends on it. `docs/EFFECTS.md` even records the unresolved possibility that the block is "Expander или второй набор EQ" — i.e. its identity is unknown, which is a research question, not a prerequisite.

**Simplicity Rationale.** This is the clearest YAGNI violation in the file. "Нужны при любом варианте" is a claim of necessity, and it is false for the third item by the project's own record. The first two earn their place (they are genuine unknowns with named consumers); the third should be either deleted or demoted to a footnote saying the question is closed pending evidence from firmware, exactly as `PLAN.md` has it. Listing it as critical work on a decision document also has a cost beyond the wasted day: it enlarges the apparent "remaining reverse engineering" and therefore distorts the comparison between variants, whose whole point is a protocol that is already "почти закончен".

---

### M4. Variant B is priced off the development machine, not off a distributable artifact, and its Windows-only reality is never stated

**Severity:** Major
**Affected Scope:** §2 "Вариант B" L58–L77; comparison table L94–L102.

**Finding.** Variant B is scored "**Покрытие:** 100% — агент имеет доступ и к USB, и к файлам MCC" (L64), "любой браузер" (L69), "Сложность | средняя" (L101). The thing being described is not the existing backend; it is a downloadable product. The existing backend is Windows-only in ways the document never mentions: `src/settings-service.js` drives `powershell.exe` and branches on `process.platform === 'win32'`; `src/audio-params.js` and `src/ui-control.js` drive Windows UIAutomation; `src/workspace.js` resolves the active profile through `HKCU\Software\TOPPING\...` in the registry; `docs/PLAN.md` L20 explicitly excludes "поддержка других ОС". So B's "100%" is 100% of one platform's features, on one OS, with a Node runtime installed.

The distribution work is absent entirely: installer and per-user install path, code signing (the document lists "антивирусы и корпоративные политики могут блокировать" as a symptom but never names the two things that cause it — an unsigned binary and a local HTTP listener), auto-update, and the support surface created by an agent that must be *upgraded* in step with the site it serves. That last item is architecturally load-bearing: a site that talks to arbitrarily old installed agents must either version its local protocol or refuse old agents, and neither decision appears anywhere in the document.

**Simplicity Rationale.** §3 asks the reader to choose between "низкая / средняя / высокая" complexity, but the three options are measured against different reference points: A against a small page, B against a backend that only ever had to run on the author's machine, C against the sum. That makes the table's central column the least trustworthy one. Because the project's stated goal is a site for "любой человек" (L3–L5), B cannot be evaluated as "keep what we have and wrap it" — it must be evaluated as "ship, sign, update and support a native agent on every OS the audience uses". Written as it is, the document makes B look an order of magnitude cheaper than it is, which biases the decision it says it is not making.

---

### M5. The document never reconciles itself with `research/WEBHID.md`, which answers the same question with different numbers and a different verdict

**Severity:** Major
**Affected Scope:** §2 "Вариант A" L30–L56, "Вариант C" L79–L89; the document as a whole (no citation of `research/WEBHID.md`).

**Finding.** `research/WEBHID.md` (2026-11-07) is the project's prior investigation of this exact question. Its conclusions are: "**WebHID технически возможен, но даёт только ~40% функционала**"; "Через WebHID их НЕ ДОСТАТЬ и НЕ ЗАПИСАТЬ" for "микшер, EQ, loopback, outputs, компрессор, реверб"; and, on the hybrid, "**Гибрид невозможен** для одного устройства: нельзя одновременно держать HID в браузере и в бекенде с записью."

ARCHITECTURE says ≈85%, says mixer/EQ/compressor/reverb *are* writable from the browser (L35–L36), and proposes the hybrid as Variant C (L79–L89) — and cites the older file nowhere. `src/tools/webhid-coverage.js` does explain in its header that the old note is superseded ("пора пересчитать"), but the architecture document, which is the one a reader will act on, does not.

The consequences are not cosmetic. A reader who knows the older note cannot tell whether the newer numbers rest on new hardware evidence (they do: EQ/compressor/reverb writes landed 2026-11-10, per `docs/STATUS.md` L114–L122) or on a changed counting method (they also do: route counting instead of capability counting). And the "гибрид невозможен" verdict is a direct contradiction of Variant C that the document silently drops instead of answering — even though the honest answer is short and would strengthen the document ("that verdict was about *simultaneous* access; C is sequential, so it stands, but the permission and MCC-conflict UX differ between the two paths").

**Simplicity Rationale.** This is the "Leverage Existing" failure with the highest cost: the project paid for a descriptor-level feasibility study (17-byte reports, `FeatureReportByteLength = 0`, the non-standard `Usage = 0x00` that makes a usage-based filter fail, `sendReport(0, …)` needing a pad byte) and the architecture document re-derives none of it and contradicts all of its conclusions. Two documents in one repository now give two different answers to "можно ли это вообще из браузера", and the author has to answer for both. One short paragraph — "this supersedes WEBHID.md's ~40% estimate; the reason is X; the 'hybrid impossible' caveat still applies to Y" — removes the contradiction entirely.

---

### M6. R1 classifies the central failure mode of the recommended variant as "not a blocker", and asserts a mitigation the baseline already says does not work

**Severity:** Major
**Affected Scope:** §6 "R1" L151–L155; duplicated in §2 "Вариант A" L53–L55.

**Finding.** "**R1. Chrome душит таймеры в фоне.** … Лечится: Web Worker с `setInterval` + запрос «не спи» через `navigator.wakeLock` (тоже не всегда работает). Это UX-проблема, а не блокер, но её надо решить до релиза."

What the baseline says: `research/WEBHID.md` §3.2 — "Chrome **душит таймеры в фоновых вкладках** … Обход: держать вкладку активной, либо использовать Web Worker (**таймеры там тоже душатся**, но меньше), либо бекенд." So the proposed cure is known, in the project's own notes, to be throttled in the same way; it is offered here as if settled. And what the device does when the keepalive lapses is not a degraded experience: `docs/STATUS.md` L28 and `docs/BACKEND.md` L49 both state the device goes silent without it, which is why every other part of the project treats the 2 s keepalive as mandatory infrastructure (`README.md`: "Keepalive обязателен, иначе устройство замолкает").

So the risk is: switch tabs for a minute and the appliance stops reporting until you come back. For a control surface for hardware, a state where the UI silently shows stale meters and unapplied writes is the difference between "works" and "doesn't". It is not UX polish; it is the one behaviour that Variant A cannot get from the backend for free, and therefore it is a decision input, not a footnote.

**Simplicity Rationale.** The standard asks for "no architectural dead-ends", and this is the one place where the document touches a dead end and waves it through. There are only three honest options and they are cheap to state: accept it and design the UI around foreground-only operation; verify empirically whether a Worker-hosted timer survives (the document already plans a spike in §8 — the keepalive belongs in that spike, not in a fix list); or let the sweep fall back to an agent, which is Variant C and changes the recommendation. Presenting an unverified workaround as the fix, inside a risk register that labels the risk "не блокер", is exactly the shape of a conclusion the project will regret. One line is enough: "не проверено; входит в спайк §8".

---

## Nit

### N1. One fact written twice in two registers

**Severity:** Nit
**Affected Scope:** L53–L55 (§2A, "Минусы") and L151–L155 (§6, "Risks R1").

**Simplicity Rationale.** The keepalive limitation is stated in the variant's cons list and again, nearly verbatim, in the risk register ("устройство замолкает без продления подписки каждые 2 с. Chrome душит таймеры в фоновых вкладках"). When a mitigation is settled, one copy will be updated and the other will not. Keep the fact in one place and cross-reference.

### N2. "Работает офлайн, если сделать PWA" is a speculative benefit attached to a service-worker build

**Severity:** Nit
**Affected Scope:** L46.

**Simplicity Rationale.** No requirement in §1 asks for offline operation, and the sentence costs more than it gives: it invites a bundler/manifest/cache-invalidation surface for a page whose only job is to talk to a device over USB, and WebHID still needs a secure context and a user gesture. A static page served from cache does not make the *control surface* work offline in any sense the user would notice. Cut the bullet; if offline matters later, it is a separate decision.

### N3. Variant C and the §8 recommendation are the same plan at two time horizons, scored as mutually exclusive options

**Severity:** Nit
**Affected Scope:** §2 "Вариант C" L79–L89; table L94–L102; §8 L202–L203.

**Simplicity Rationale.** C is defined as "site tries WebHID, offers the agent when something is out of reach". §8 recommends exactly that sequence — "Вариант A для первой версии… вариант B всегда можно добавить позже как «pro-режим»". Presenting C as a third column with "Сложность | высокая" invites the reader to weigh an option that the recommendation has already taken; the real choice is binary ("first release ships WebHID-only, yes/no") plus a scheduling note. Collapsing three columns into two makes the table state a decision instead of three moods, and removes a row of complexity that nobody is choosing between.

### N4. The "зачем" column has no entry for the firmware row

**Severity:** Nit
**Affected Scope:** §5 table, L142.

**Simplicity Rationale.** Every other row in "Осталось отреверсить" says what the work buys ("применение записи ducking и loopback | сейчас доказано только, что запись не ломает устройство"). The firmware row says "10%, отдельный трек" — a status, not a purpose, in a column headed "why". Either state the purpose (it exists elsewhere — `docs/PLAN.md` §5 wants it for features the current firmware lacks) or drop the row, since L144–L145 already excludes it from what "нужно при любом варианте".

---

## Summary

| Severity | Count |
|---|---|
| Blocker | 0 |
| Major | 6 |
| Nit | 4 |

The document's altitude is right and its instinct is right: it refuses to pretend the backend can be moved to a server, it names the one constraint that decides the answer, and §8 ends with the correct next action — prove Variant A with a small page before designing anything. That last paragraph is the strongest thing in the file, and it is also the measure of the rest: the architecture is being chosen before the one experiment that would settle it, so the sections that carry numbers are carrying weight they cannot bear. Fixing M1 (count capabilities, not routes), M2 (split transport by responsibility), M4 (price B as a shipped product) and M5 (say what supersedes WEBHID.md) leaves a decision document that is short, honest about what is verified, and congruent with the rest of the repository. M3 and M6 are deletions and one-line demotions.
