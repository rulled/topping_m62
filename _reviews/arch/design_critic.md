# Design Critic Goldfish — REVIEW

**Reviewer:** `egm-design` (design_critic)
**Target:** `docs/ARCHITECTURE.md`, whole file (212 lines)
**Standard:** Feature Specification Standard (`references/standards/feature-spec-standard.md`)
**Baseline read:** `docs/STATUS.md`, `research/WEBHID.md`; plus the artifacts the document itself cites or depends on (`src/tools/webhid-coverage.js`, `src/server.js`, `src/transport.js`, `src/protocol.js`, `src/state-store.js`, `src/snapshots.js`, `docs/PROTOCOL.md`).
**Mode:** REVIEW

**Result:** 1 Blocker, 8 Major, 4 Nit.

Scope note. The document is an honest decision memo and it states its own status ("Решение ещё не принято — документ для проверки"). That framing is respected here: nothing below asks it to become an implementation plan. What it is audited for is what the standard asks of any specification — that the options are real alternatives, that the numbers the recommendation rests on are traceable to their source, and that the risks the chosen path creates are named and mitigated rather than deferred.

---

## Blocker

### 1. The 85% coverage figure is not what its cited measurement produced, and the 15% remainder is neither the tool's list nor a capability list — so the recommendation rests on a number no reader can verify

**Severity:** Blocker
**Affected Scope:** §2 "Вариант A" L33–L41; §3 comparison table L94–L102; §8 L194–L203.

**Finding.** L33–L34 states the coverage as "измерено `node src/tools/webhid-coverage.js` — **53 из 62 маршрутов (85%)**". Two things are wrong with that sentence.

First, the script does not measure coverage — it greps `src/server.js`, bins each route body by the presence of substrings from three hard-coded lists, and prints percentages. Nothing in it touches WebHID, a device, or a browser. The word "измерено" assigns empirical authority to a static heuristic, and the whole of §8's first justification ("85% функций работают без установки — это главная ценность идеи", L196) inherits that authority.

Second, the composition does not survive a run. Executing the cited command gives the "МОЖНО ПОВТОРИТЬ В БРАУЗЕРЕ: 53 (85%)" list, and it contains:

- `POST /api/eq/open`, `POST /api/compressor/open`, `POST /api/compressor/close` — the three "открытие окон MCC" routes that L41 declares недоступны;
- `GET /api/audio-params`, `POST /api/audio-params` — the sample-rate / buffer-size routes that L40 declares недоступны (they call `readAllAudioParams` / `setAudioParam`, and `src/audio-params.js:4` says these change "ТОЛЬКО клавиатурой").

They land in the reachable bucket because the classifier strips `try { … } catch { … }` blocks before matching (`stripGuarded`, `src/tools/webhid-coverage.js:78–86`), and those five routes were rewritten so the MCC call sits inside the guard. The same strip also swallows `workspace.describe` in `POST /api/state/import`, which is therefore counted as reproducible in a browser while depending on MCC's profile folder.

The 15% is then re-enumerated from belief rather than from the tool: L38–L41 lists profiles, sample rate, and MCC window opening, while the tool's own unreachable set is 9 routes — `GET/POST /api/workspace`, `/api/workspaces`, `/create`, `/delete`, `/switch`, `/api/workspace/apply`, **`GET /api/mode` and `POST /api/mode`**, and `POST /api/mcc/click`. The counts coincide (9/62 ≈ 15%), which makes the mismatch invisible, but the contents do not: the document silently loses **mode detection and mode switching** from its risk accounting, and silently gains five window/UIAutomation routes it claims are unreachable. Mode is not a rounding error — `docs/FOR-DESIGNER.md` L55–57 states the UI cannot be static because the available blocks change per mode, and `GET /api/mode` is how a client knows which blocks to render.

The denominator is also tri-modal across the repository: 62 here (regex over `src/server.js`), 56 "пар метод+путь" in `docs/PLAN.md` L29 (same repo, one day earlier), 48 "эндпоинтов" in `docs/STATUS.md` L15. No reconciliation is offered, and the headline percentage moves with the choice.

**Recommendation.** Replace the route ratio with a capability ratio and state the basis. The honest enumeration of user-facing M62 capabilities already exists as the coverage map in `docs/STATUS.md` L46–65 (gромкости, настройки, метры, EQ входов, EQ наушников, компрессор, реверб, микшер, loopback, ducking, профили, sample rate, режим) — thirteen lines, each of which can be marked доступно / недоступно for A and B. A route is an HTTP artifact that a browser client will not have; a capability is what the user loses. If the route count is kept, it must be reconciled against 56 and 48 and the unreachable set must be the tool's actual output, including mode.

---

## Major

### 2. R3 names the milder failure mode: with MCC running, writes are silently rolled back, not refused

**Severity:** Major
**Affected Scope:** §6 R3 L161–L164; §1 L17–L20.

**Finding.** L161–L164 treats the MCC conflict as an `open()` failure: "WebHID может не открыть устройство на запись. Надо показывать внятную ошибку и инструкцию «закройте M Control Center», а не молча падать." The project's own record says the dangerous case is the opposite — the open succeeds and the write is discarded. `docs/PROTOCOL.md` §5.0 point 1: "**Работающий MCC откатывает записи.** MCC держит свою копию состояния и периодически возвращает устройство к ней. Замерено: с запущенным MCC запись `0x46:02 = -28` не применялась 60+ секунд; после закрытия MCC применилась за 10 секунд." `src/transport.js` L305–L309 repeats it for the mixer: "при работающем MCC запись будет откачена". `research/WEBHID.md` L77–L80 records that a second reader can open the device alongside MCC for reading — so the browser may well hold the device and still have every DSP write reverted.

Consequence for the design: the "внятная ошибка" mitigation in R3 covers only the case that produces an exception. The case that produces a UI showing the new value while the device keeps the old one is unaddressed, and that is precisely the case this project already spent a month on (`docs/STATUS.md` L37–40: the compressor and EQ were believed unreachable "из-за ошибки метода"). Variant A has no server-side reconnect-and-re-dump loop to detect the rollback.

**Recommendation.** Restate R3 as a correctness risk with a detection requirement, not a user-education risk: the client must be able to tell "accepted" from "rolled back". Minimum mitigation to specify — after a write, request a fresh dump and, if the value did not change, surface "M Control Center конфликтует, закройте его" rather than a success toast. Note that `docs/PROTOCOL.md` §5.0 point 2 adds a second trap: read-back in the same session returns the cache, so the detection needs a re-subscribe, not a local re-read.

### 3. Variant A has no durable home for the state the device cannot return; the document gives it one clause and no recovery path

**Severity:** Major
**Affected Scope:** §4 L110–L112; §7 item 2 L180–L182; §8 L210–L212.

**Finding.** L110–L112: "**Хранит состояние микшера и loopback** в `%APPDATA%\m62\state.json` — заменится на IndexedDB в браузере." That is the entire treatment of the subject, and it is the only sentence in the document about where user configuration lives under A.

What it replaces is not a cache. `src/state-store.js` L6–L10 and `docs/STATUS.md` L138–L142: mixer (`0x31..0x3c`), loopback (`0x51..0x58`) and ducking (`0x43`) are **write-only** — `IN=0` in every capture. The device will never hand them back. The JSON file is therefore the single copy of the user's mixer matrix, and under A its successor is one origin's IndexedDB. The document does not address any of the consequences:

- **Silent total loss**: clearing site data, a new browser profile, or (per R2, L157–L159) a domain change destroys the mixer configuration with no way to recover it from the hardware and no export path in the plan.
- **Quota and eviction**: IndexedDB is subject to origin storage clearing under pressure and browser-managed eviction; the document mentions IndexedDB once and never its durability characteristics.
- **Two-state hazard**: the browser copy and the MCC INI copy can both exist and disagree once a user alternates between the site and MCC. `src/state-store.js` L27–L28 allows a one-shot import from INI; the reconstructed browser equivalent of "when is INI allowed to win" is not stated.
- **Multi-tab**: two tabs of the same origin share IndexedDB but cannot share one device handle; the document says nothing about a single-writer rule, which `src/state-store.js` L21 explicitly names as a design rule ("Одна модель состояния, один файл, один писатель").

Because §7 item 2 and §8 L199–L200 then build the "свои профили" plan on this same store, the hole is load-bearing, not incidental.

**Recommendation.** Give state a first-class section: storage choice with its eviction semantics, a single-writer rule for tabs, an explicit export/import file (the natural mitigation for both eviction and the origin-change loss), and a stated precedence rule between the browser store and MCC's INI. If the answer is "we accept loss", say so in the risk section with the user-visible consequence spelled out.

### 4. The session machinery the 85% depends on is absent from the risk analysis, and R1 misstates what has to stay alive

**Severity:** Major
**Affected Scope:** §6 R1 L151–L155; §2 L53–L55; §4 L120–L125; §8 L205–L208.

**Finding.** R1 describes one periodic timer: "keepalive (каждые 2 с)". That is the subscription renewal from `research/WEBHID.md` §3.2, and it is not the only timed dependency. `src/transport.js` L129–L169 shows three, and the third is the one that gates the feature coverage the document claims:

1. subscription `0x11:0x24` every 2 s (`KEEPALIVE_MS`, `src/protocol.js` L53) — R1's timer;
2. periodic full-state request `0x11:0x26` every 15 s (`ANNOUNCE_MS`, `src/transport.js` L40, L160–L169) — without it, EQ input blocks `0x91..0x94` and headphone EQ `0xa1..0xaa` do not arrive at all; `src/transport.js` L137–L144 records 6 tags on the first announce versus 174 four seconds after a repeated one;
3. session handshake `0x11:0x01` (`src/transport.js` L111–L116) — a handshake **with a reply**, and until the device answers, part of the state never comes (`src/protocol.js` L28–L43: 44 tags before, 96 after).

Under Chrome's background-tab throttling — the very mechanism R1 is about — timers two and three are as dead as timer one. The stated mitigation (Web Worker + `navigator.wakeLock`, L153–L155) is asserted without noting that `wakeLock` is released on tab hide by default and requires a `visibilitychange` re-acquisition loop, and that a Worker is a different place to hold the device state, not a place where timers are exempt. Meanwhile the claim in §2 L34–L36 that "EQ входов и наушников" are covered by Variant A is a claim about a state stream that only exists while those timers run.

There is a second, unmentioned volume problem in the same file: `src/transport.js` L183–L194 records that a naive one-report-per-tick read loop loses most of the state (2 of 8 settings tags), and the fix was batching up to 64 reports per tick. A browser client receives `inputreport` events one at a time on the main thread (`research/WEBHID.md` L58–L61). The document never asks whether several hundred events per second, plus parse and cache updates for each, are affordable in a tab that also renders a UI — and that question is exactly the kind that decides whether Variant A is a demo or a product.

**Recommendation.** State the full timed dependency set (2 s subscribe, 15 s dump, handshake with reply) and the inbound event rate, and treat "can a background tab keep this device synchronised" as a measurable acceptance question, not a UX footnote. The experiment §8 proposes is the right place to measure it — it should be required to run for at least one announce cycle in a hidden tab.

### 5. "Браузер к ним не имеет доступа" is false, and it is the stated reason for sacrificing profiles

**Severity:** Major
**Affected Scope:** §2 L39, L64; §7 item 2 L180–L182; §8 L199–L201.

**Finding.** L39: "профили MCC — это файлы на диске, браузер к ним не имеет доступа", repeated at L64 for the agent's advantage and again in §7 item 2. A Chromium-only client — which Variant A already is by definition, L49–L50 — can read and write a user-chosen directory through the File System Access API (`showDirectoryPicker`), with persistence across sessions after a permission grant. That is the same trust gesture as the WebHID device grant the document already asks for ("дать разрешение на устройство", L15). Profiles would then be readable and writable in Variant A without an agent.

The document does not have to adopt this; it has to evaluate it. As written, a false absolute is doing load-bearing work: it is the first item in the "Недоступно (15%)" list (L39), the reason the "свои профили" workaround appears in §7, and one of the four bullet reasons in §8 ("Профили можно сделать свои", L199–L200). If directory access is viable, one of the four justifications for Variant A dissolves, and if it is not viable, the reason (permission fatigue, second grant prompt, user must locate `C:\Program Files\TOPPING Pro\…`) should be recorded — because that reason is the same argument that decides whether Variant B is "install a process" or "install nothing but grant a folder".

**Recommendation.** Add the File System Access API as an evaluated option for the profiles capability, with a concrete rejection rationale if rejected. Note also that reading MCC's INI is not the only path to compatibility: writing MCC's own file format into a user-granted folder would preserve profile interoperability, which L181–L182 currently declares impossible ("они не будут совместимы с профилями MCC").

### 6. The three options are one axis of variation, not three alternatives — and the two genuinely different ones are missing

**Severity:** Major
**Affected Scope:** §2 L24–L88; §3 L92–L102; §8.

**Finding.** The standard's Alternatives Rule requires proof that other viable designs were considered and rejected for concrete reasons. A, B and C differ only in *where the HID transport runs* (browser / local process / both). Two designs that differ on other axes are absent:

1. **WebUSB instead of WebHID.** The baseline's own §3.3 (`research/WEBHID.md` L91–L97) records that the device's HID Usage is `0x00`, an outlier that forces VID/PID-only filtering and leaves the device unnamed in Chrome's chooser. WebUSB claims the interface directly and does not consult usage pages at all. Whether it is viable here — one interface, vendor-specific, possibly requiring the device to expose a WinUSB-compatible interface descriptor, plus a different permission model — is an open engineering question, but it is exactly the kind of question that changes Variant A's risk profile. It is never mentioned.
2. **A packaged desktop shell (Tauri/Electron/Wails) around the existing backend.** This keeps 100% capability, removes the Node install, removes Private Network Access (L74–L76), removes the background-tab problem entirely, and avoids reimplementing the transport policy in a second language surface. Its cost is a signed installer and an update channel — which is a cost the document already pays in spirit by listing installation as Variant B's fatal flaw, but never prices. The comparison table's "Сложность: низкая / средняя / высокая" (L101) offers no unit, so a packaging option cannot be placed on it.

Without these, §8's recommendation is a choice among three shadings of one design, and the reader cannot tell whether the real alternative — keep the working backend, wrap it — was considered and rejected or simply not thought of.

**Recommendation.** Either add these two rows/options with explicit rejection rationales, or state the constraint that excludes them ("only a URL is acceptable to the audience, no binary of any kind ever"), which is a legitimate and much stronger way to justify Variant A. A named constraint also makes the recommendation falsifiable: it says what would change the answer.

### 7. Platform scope is never stated, and "ничего не устанавливать" is a Windows-only claim presented as universal

**Severity:** Major
**Affected Scope:** §1 L14–L15; §2 L30–L31, L43–L46; §3 L94–L102; §6 R4.

**Finding.** The goal is stated without an OS qualifier: "сайт, где любой человек подключает свою M62 и управляет ею" (L4–L5), "ничего не устанавливать" (L44). Every piece of evidence in the baselines is Windows-only: `research/WEBHID.md` L10–L18 identifies the device through `HidP_GetCaps` and a `\\?\hid#…` path; `docs/STATUS.md` describes UIAutomation, `C:\Program Files\TOPPING Pro`, `%APPDATA%`. The document never asks whether the same browser flow exists on Linux or macOS.

On Linux, Chrome's HID access goes through `hidraw` and requires a udev rule (or the user in a group) before the device is usable at all — a system configuration step that is not "nothing to install" and that no website can perform. That single fact changes Variant A's audience from "anyone with Chrome" (L97: "Браузеры: Chrome/Edge") to "anyone with Chrome on Windows, or on Linux after an admin step". Variant B's cross-browser advantage (L68) is stated, but A's cross-platform limitation is not, and the comparison table has no OS row at all.

**Recommendation.** Add the supported-OS scope explicitly and carry it into §3. If the target is Windows only, say so at the top — it is a perfectly defensible scope for this project, and it also disposes of a class of questions (udev, macOS permissions) that would otherwise inflate both variants. If it is not, the Linux setup requirement belongs in R-list, because it is the one thing in Variant A that the user genuinely must do outside the browser.

### 8. §4's module inventory mislabels portability in both directions, and omits the file where the behaviour actually lives

**Severity:** Major
**Affected Scope:** §4 L106–L125.

**Finding.** L120–L125 asserts: "Модули `protocol.js`, `mixer-tags.js`, `eq-hid.js`, `comp-hid.js`, `reverb-hid.js`, `modes.js`, `tags.js`, `controls.js`, `settings.js` не зависят от Node и переносятся в браузер без изменений." Three problems:

1. **`protocol.js` is first in the list and is not portable.** `src/protocol.js:100–105`, `withReportId()`, is `Buffer.alloc` / `Buffer.from(frame).copy`. `Buffer` is a Node global; the browser has `Uint8Array`. This is not a corner of the module — `withReportId` builds the 16-byte report the HID layer writes, so it is the first function any browser client calls. A reader who trusts L120–L125 reaches `ReferenceError: Buffer is not defined` on the very first frame, in the file they were told to copy verbatim.
2. **`server.js` appears in neither list, and it is where the accumulated behaviour is.** The document's framing — "ядро протокола переносится, обвязка — нет" (L120) — implies a clean split, but `src/server.js` holds logic that is neither protocol nor Node-specific and that a browser rewrite would have to re-earn: the hex/decimal cache-key disambiguation (`snapshotValue`, L218–L223, needed because `transport.snapshot()` emits decimal keys per `src/transport.js` L332–L341), the delta-versus-absolute-value resolution with its "current value unknown → 409" fallback (`src/server.js` L1197–L1241), the optimistic cache rule that prevents a stale `Bypass` from refusing a reverb write (`src/transport.js` L372–L388), and the workspace-versus-HID mode consistency check (`src/server.js` L708–L723). Calling this "обвязка" and dropping it means the new client reimplements it from observation.
3. **`snapshots.js` is in neither list while backing five of the routes counted in the 85%.** `src/snapshots.js` L13–L16 imports `node:fs`, `node:path` and `./workspace.js`, and writes to `research\snapshots` (L18). The tool's reachable bucket contains `GET/POST /api/snapshots`, `/get`, `/diff`, `/apply`, `/delete`. So either those five routes are not reproducible in a browser (and the 85% is wrong in the other direction) or they need a storage design the document does not mention. `src/audio-params.js` (UIAutomation) is likewise only implied by the mention of `ui-control.js`.

**Recommendation.** Split §4 into three lists and make the boundary explicit: (a) portable as-is, (b) portable after a documented change — naming `protocol.js`'s `Buffer` sites and the transport-policy layer (batched reads, timers, optimistic cache, reconnect) which is plain JS and must survive the move, (c) not portable — `node-hid`, `fs`, UIAutomation. Then state where the `server.js` behaviour goes. This is the one section whose inaccuracy costs a full rewrite of the client's hardest parts.

### 9. Cost and operational economics are absent, while Variant B is rejected on a cost that is never priced

**Severity:** Major
**Affected Scope:** §2 L66–L77; §3 L92–L102; §8 L192–L203.

**Finding.** The comparison table prices complexity with three unquantified adjectives (L101) and installation with "да"/"нет". There is no estimate of what any option costs to build, ship, or operate, and the document's conclusion is a cost verdict ("это убивает идею «просто сайт»", L73).

Concretely missing:

- **Distribution cost of B**, which the document itself raises and then drops: L74–L77 names CORS, Private Network Access ("политика меняется"), and antivirus/corporate blocking. A local agent that antivirus may block cannot be shipped unsigned, so B implies a code-signing certificate, a SmartScreen reputation ramp, an installer, and an auto-update channel — a recurring cost and an operating obligation. That cost, not the 15% coverage gap, is the real reason B is wrong for the first version; stated as "надо установить и запустить процесс" it sounds like a preference.
- **Operating cost of A**: L172–L173 concludes the server is "раздача статики". That is cheap but not free of obligations: a static site cannot be patched in place if a firmware revision changes the protocol, and every cached client keeps writing old frames until its cache expires. No versioning or protocol-negotiation story exists — notable because the project's own protocol has a firmware-version-dependent handshake reply (`src/protocol.js` L41–L43: "Наше устройство отвечает `2` (не 3)").
- **Support cost of both**: no error-reporting channel is designed. §7 item 4 raises telemetry and answers it with "должна быть явно opt-in" — but with no server, there is nowhere for opt-in telemetry to go, so the statement is currently not implementable. When a user writes "мой микшер не работает", there is no artifact to ask for.

**Recommendation.** Add a short economics block with three lines per option: build cost (what must be written, with the §4 port as the yardstick), ship cost (signing, installer, updater, store listing — zero for A), run cost (hosting, patch path, support surface). Then the recommendation reads as a trade of money for coverage, which is what it actually is.

---

## Nit

### 10. The gate §8 proposes has no pass condition

**Severity:** Nit
**Affected Scope:** §8 L205–L210.

**Finding.** "проверить вариант A на практике — маленькая страница, которая открывает устройство через WebHID, шлёт handshake и показывает громкости. Пока это не проверено, всё остальное — теория." The document correctly identifies the decisive experiment and then leaves its own decision rule unstated: nothing says what result confirms or kills Variant A. "Показывает громкости" is satisfied by one slider moving, which would be true even if EQ, the 15 s dump, and background synchronisation all fail — the three things that actually decide the case.

**Recommendation.** Attach 4–6 assertions to the spike, each a yes/no: handshake reply observed; ≥90 tags in the first dump; `0x91..0x94` present after a second announce; writes applied and confirmed in a fresh session; the session survives 60 s in a hidden tab. Then §8 has a result, not an impression.

### 11. R5's multi-user claim is not a differentiator, and it is stated in a section reserved for risks

**Severity:** Nit
**Affected Scope:** §6 R5 L169–L173.

**Finding.** "«Любой, кто зайдёт, управляет СВОЕЙ m62» — это работает только в варианте A". It works equally in B: a site plus a per-user local agent is also one device per user. The true statement is that neither A nor B needs a shared backend with USB access, which makes the second half of R5 ("сервер — это раздача статики") correct but unremarkable, and makes the first half misleading about what A uniquely offers. The actual unique property — best stated once, at the top — is "no binary to install", which is already L44.

**Recommendation.** Rewrite R5 as the constraint it really is ("никакой сервер не видит устройства — это свойство задачи, а не выбранного варианта") and drop the "только в варианте A" claim.

### 12. R4 dismisses the security question, and the security model the standard asks for is never written

**Severity:** Nit
**Affected Scope:** §6 R4 L166–L167; §7 item 4 L186–L188.

**Finding.** R4: "Сайт на HTTPS, устройство в браузере. WebHID требует безопасного контекста — HTTPS подходит. Проблем нет." That answers transport confidentiality and stops. The design it supports gives a web page the ability to write arbitrary DSP frames into a user's hardware, and the permission is persistent per origin (R2, L157–L159). The document never states what that implies for the site itself: a single XSS on the page becomes a hardware write primitive; any script included from a third party inherits it; a formerly trusted origin keeps the grant after it changes hands. None of this requires a page of prose — one paragraph in R4 and one constraint ("no third-party JavaScript on the control page; the protocol modules are the only code that may call `sendReport`") would cover it, and the standard explicitly asks for security implications.

**Recommendation.** Turn R4 into a real entry: the grant is persistent and per-origin, therefore the page that holds it must have no third-party script and a CSP; the client never sends frames derived from untrusted server input. Also note that a compromise of the site is a compromise of the hardware, which argues for keeping the static bundle small and auditable — an argument that happens to favour A if it is made explicitly.

### 13. §5 calls sample rate "нужен при любом варианте" while §8 proposes to sacrifice it under A

**Severity:** Nit
**Affected Scope:** §5 L135–L145; §8 L199–L201.

**Finding.** L144–L145: "Первые три нужны при любом варианте — они про устройство, а не про способ связи." The first three include "sample rate и buffer size в HID" (L140). But under Variant A, per L40 and L200–L201, sample rate is given up: "sample rate — редкая настройка, ей можно пожертвовать на старте". Both statements can be true only in different senses — the reverse-engineering question is variant-independent, the capability is not. As written a reader cannot tell whether A ships without sample-rate control permanently or only until the HID path is found.

**Recommendation.** Separate "что осталось узнать" from "что будет доступно в каждом варианте": mark sample rate as "доступно в B, недоступно в A до находки HID-пути" and state whether its absence in v1 is accepted permanently or is a blocker for someone. The same table then doubles as the promise the site makes to users.
