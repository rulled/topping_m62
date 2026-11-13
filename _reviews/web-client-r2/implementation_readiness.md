# Implementation Readiness Review — `docs/WEB-CLIENT.md`

**Reviewer:** `implementation_readiness` (Goldfish, fresh context)
**Mode:** REVIEW
**Target:** `docs/WEB-CLIENT.md`, whole file (358 lines)
**Baseline consulted:** `docs/STATUS.md`, plus the repository code the document cites
**Date:** 2026-11-14

**Result:** 4 Blocker, 7 Major, 4 Nit.

Scope note: the document opens by saying it is written "как основа для ревью" and contains "только то, что можно проверить по коду". That makes it a description of an existing system, and a description is not automatically a plan — but the same text is also the only document an engineer would get before building the parts §6 lists as "не сделано". It is therefore audited on the standard's actual question: can a competent engineer, or a fresh session, execute from this text and produce correct changes on the first attempt without guessing? For the parts that already exist the document is accurate and checkable; for the parts that remain, and for three of its load-bearing claims, it cannot yet be executed as written.

---

## Blockers

### 1. The remaining work has no file boundary, no phases, no per-file steps and no test plan

**Severity:** Blocker
**Affected Scope:** §6 "Не сделано" table (lines 213–224), §11 (lines 342–358), and the document as a whole

**Finding & Guidance:**
The standard asks for four things of a document that is to be acted on: an explicit repository-relative file list to create/modify/delete, the precise logic change per file, specific test cases with assertions, and a phasing in which each phase leaves the tree buildable. None of the four is present for any item in the "не сделано" table, so every one of those rows stops at the level of intent.

Concrete example: line 217 reads `EQ входа IN 2 (0x93, 0x94) | протокол тот же, нужен UI`. The addresses are given; everything an implementer needs is not. The document does not say which file changes (`web/index.html` is implied but never stated), which function to call (`src/eq-hid.js:180` `buildEqFrames(channel, band, field, value)` already accepts `'IN2'` and `src/tools/test-ui-frames.js` already asserts `'EQ IN2 полоса1 -> 0x93:0x03'`), what the control set is, whether the existing `sendEq()` path (`web/index.html:202–215`) is reused, or what the new test assertion is. The same hole exists for "тип, частота, Q фильтров EQ" (line 219 — addresses known, no control spec, no ranges, no defaults), "loopback (4 пары)" (line 221 — no file, no API shape, no UI placement) and "ducking" (line 222).

Because the "Следующие шаги" section of `STATUS.md` calls the frontend "отдельный большой этап", this document is the entry point to that stage, yet it defines no phase 0/1/2 and no per-phase exit condition. Add, for each remaining item: the exact paths to touch, the function signatures to add or reuse, the control list with ranges and defaults, and the assertion that proves it — plus a phase split in which each phase builds and is verifiable on its own (the natural seams are already visible: IN 2 EQ → EQ type/freq/Q → HP EQ → mixer → loopback/ducking → scenes).

### 2. The adapter contract stated in §3 cannot support the EQ-confirmation rule stated in §5, and on the primary path nothing replaces it

**Severity:** Blocker
**Affected Scope:** §3 "Границы" (lines 85–87), §5 (lines 136–169), §6/§7 description of the shipped page

**Finding & Guidance:**
§3 defines the adapter contract as exactly three methods: "`write`, `onData`, `close`", with "Всё остальное — handshake, подписка, keepalive, кеш, коммит — внутри". §5 then states that the *only* way to confirm an EQ write is `readFresh()`, which closes the session and opens a new one (lines 164–169).

Those two statements are incompatible. `src/transport-core.js:335–342` guards `readFresh()` with `if (typeof this.adapter.reopen !== 'function')` and returns `null` otherwise, logging "адаптер не умеет reopen()". `src/adapter-nodehid.js:117` has `reopen()`. `src/adapter-webhid.js` has none — the file's exports are `isWebHidSupported`, `requestDevice`, `pickVendorInterface`, `createWebHidAdapter`, `openWebHidDevice` (lines 35, 45, 69, 91, 153), and the string `reopen` does not appear in it.

The consequence is that on path A — the primary, headline path — the document's central correctness mechanism is unavailable, and the document does not say so anywhere. Worse, the page it documents does exactly what §5 forbids: `sendEq()` calls `writeEqWithCommit()` then `await t.readViaDump()` and logs `✓ ${label}` (`web/index.html:202–215`), while §5 lines 156–160 explain that in an already-open session `readViaDump()` returns the cache and "выглядит как «применено», даже если карта запись отвергла". §5's third bullet (`POST /api/eq/band` answers `applied: "unverified"`) only exists on the server path (`src/server.js:1519`), which path A does not use at all.

Fix by making the contract explicit and complete: state `reopen()` as a required fourth adapter method (optional only for adapters that never confirm), and specify its WebHID implementation (close handle, re-attach the `inputreport` listener after `device.open()`, what happens if the user revoked permission mid-session). If the intent is that path A cannot confirm EQ writes, then say that instead, and specify what the browser UI shows and logs in that case — the current `✓` in the log is a false confirmation and must be removed from the design, not left to the implementer to discover.

### 3. "The server serves only static files / is not needed for path A" is false, and following §10 makes the server a second writer on the same card

**Severity:** Blocker
**Affected Scope:** §2 A (line 31), §3 (lines 96–98), §9.3 (lines 283–285), §10 (lines 309–330)

**Finding & Guidance:**
§2 A states flatly: "Сервер отдаёт только статические файлы." §3 repeats the implication: "Сервер не обязателен для пути A. Он нужен как раздача файлов… Если страницу раздать иначе, сервер не нужен вовсе."

That is not what `src/server.js` does. It constructs a transport at module load (`src/server.js:109`) and, inside the `server.listen` callback, calls `M62Transport.find()` and `transport.open()` on startup (`src/server.js:2311–2318`); a second lazy open sits at line 2169. So the recommended procedure in §10 — start the server on 8898 (step 3), then open the page and press "Подключить" via WebHID (step 5) — puts the Node transport and the browser's WebHID handle on the same device simultaneously, with independent keepalive, announce and cache.

The document itself says in §9.3 that this is the failure mode to avoid: "при одновременной работе две программы перезаписывают настройки друг друга". The rule is stated for MCC and then violated by the document's own launcher. There is no flag in `server.js` to run static-only (only `M62_PORT` and `M62_HOST`, lines 98–99).

Fix: either (a) specify a static-only mode of the server (flag/env, transport not opened) and use it in §10, or (b) delete the claim that the server only serves files, state that the Node transport claims the card at startup, and instruct the reader to stop the server (or serve the page from another static host) before connecting through WebHID. As written, an implementer will ship a deployment in which the server holds the card and silently rewrites what the page writes.

### 4. §11 leaves the remaining design decisions open, which the Zero-Decision Rule forbids

**Severity:** Blocker
**Affected Scope:** §11 (lines 342–358), §6 line 223

**Finding & Guidance:**
§11 is presented as "Что осталось открытым", and two of its three items are decisions an implementer must make to finish the work. The standard is explicit that such choices must be pre-determined in the document, not left to the implementer.

- §11.1: "Где хранить сцены? Сейчас — `localStorage` браузера (не реализовано). Альтернатива: сервер, но тогда нужна идентификация пользователя." This is the textbook forbidden choice. It also contradicts §6 line 223, which says "сохранение сцен | нет хранилища" — "сейчас localStorage" asserts a decision the table denies. Pick one: storage medium, key/shape of the stored record, versioning, what happens when a scene references parameters the card cannot read back (§9.4), and where the code goes. If the answer is "not in this phase", say that in §6 and remove the row from §11.
- §11.2: "Любой UI будет показывать наши предположения, а не факт." The truthful observation, but it is a design fork left undecided: either build the mixer UI with an explicit "unverified" state whose source of truth is `src/state-store.js`, or decline to build it and say why. The implementer cannot invent that policy. Note the document already has the machinery to cite — `state-store.js` holds exactly the non-readable state (mixer, loopback, ducking) in `%APPDATA%\m62\state.json` and is marked Node-only in `src/server.js:259`, i.e. unavailable to path A; that constraint is the decision's actual input and is not stated.

§11.3 (firmware integrity) is fine as written — it already reads as a decision not to implement. Move it out of "открытое" or label it "решено: не делаем", so the section stops mixing decided and undecided items.

---

## Majors

### 5. §5 claims the invariants are enforced so callers cannot do it wrong; two of them live in the page, not in the core

**Severity:** Major
**Affected Scope:** §5 (lines 144–148, 180–181), §7 (lines 229–239)

**Finding & Guidance:**
Line 180: "Все эти правила собраны в `transport-core.js` и доменных модулях, чтобы вызывающий код не мог сделать неправильно." That is false for at least two entries of the table directly above it.

- "выходы писать в ОБА адреса пары". `M62TransportCore.writeFrames()` (`src/transport-core.js:261–273`) sends exactly the frames it is given; the pairing exists only in the page's handlers (`web/index.html:377–393`: two `send([...])` calls with both targets). A second caller — the path B UI, or any new control — gets no guard.
- "48 В… включается только после `confirm()`". The confirmation is in `web/index.html:411–413`; `buildPhantomFrames()` in `src/phantom-hid.js` has no confirmation concept and will happily build the enabling frame.

The document is aware of the layering problem, because lines 144–148 do exactly this analysis for the DFU rule ("Правило про interface 3 действует не в ядре, а в адаптере"). Apply the same treatment to the whole table: add an enforcement column (core / domain builder / adapter / caller) and, for caller-enforced rules, specify the mandatory guard. Better: move the pair and phantom guards into the domain builders (e.g. `buildHpVolumeFrames(value)` returning both targets) and state that as the required design.

### 6. Path B is described as if it exists; it does not

**Severity:** Major
**Affected Scope:** §2 B (lines 45–59), §3 layer table (lines 66–81), §6 "не сделано" table

**Finding & Guidance:**
§2 B presents the local agent in the present tense with an arrow diagram: "браузер ──── HTTP ────► агент (localhost) ──── node-hid ────► M62". Nothing in the tree implements the agent leg. `web/index.html` contains no `fetch(` call and no `/api/` reference; its only imports are the six browser modules (lines 159–164). Only two adapters exist (`src/adapter-webhid.js`, `src/adapter-nodehid.js`), and `src/adapter-nodehid.js` is explicitly blocked from being served (`src/server.js:259`, `'/src/adapter-nodehid'` in `STATIC_DENY`). There is no route that accepts transport-core frames.

Unlike §6, which is careful to separate what exists from what does not, §2 B never says "не реализовано". An implementer reading the layer diagram will assume the agent exists and go looking for it, or worse, assume the page can fall back to `http://localhost:8787` when WebHID is absent — it cannot. Either mark path B as not implemented in the same style as §6, or specify it: endpoint set and wire format, who owns the device handle, what the page does when both are available, and which files implement it.

### 7. "Итого 40 адресов на вход" contradicts the document's own EQ numbering

**Severity:** Major
**Affected Scope:** §6 (lines 198–208), §5 (lines 136–138)

**Finding & Guidance:**
Lines 202–204 give the correct block map (IN 1 = `0x91` for bands 1–2, `0x92` for bands 3–4; IN 2 = `0x93`, `0x94`), then line 208 concludes "Итого 40 адресов на вход". The arithmetic in the same paragraph — 2 blocks × 2 bands × 5 properties — is 20 per input, 40 for both. `src/eq-hid.js:36` states the same total for all four blocks: "Итого 4 блока x 2 полосы x 5 полей = 40 параметров." And §5 line 136 measures "0 EQ-адресов вместо 40" for the whole session.

An implementer who uses 40 per input will build a completeness check that can never pass, or will look for two extra blocks that do not exist. Change line 208 to "Итого 20 адресов на вход, 40 на оба".

### 8. The headline "5/5" evidence for applied writes is circular

**Severity:** Major
**Affected Scope:** §8 "Проверено фактами", line 249

**Finding & Guidance:**
The row reads: "Ядро работает на живом устройстве | `test-transport-core.js`: 92 адреса, запись компрессора и EQ применены, 5/5". Both write results in that script are reads of the local cache, not of the card.

`src/transport-core.js:265–269` (in `writeFrames`) and `:311–314` (in `writeEqWithCommit`) store the written value into `this.cache` unconditionally. The test then reads that cache: `const after = t.get(0x46, 0x03)` and `writeOk = after === target` (`src/tools/test-transport-core.js:100–103`), and `eqDump['145:3']` from `readViaDump()` (`:115–118`). By the document's own §5 rule, `readViaDump()` in an open session returns exactly those cached values, so the assertion is true whether or not the card accepted anything.

This matters because the row is the document's proof that the core is browser-ready, and `research/NOTES.md` §154.2 repeats the same "ПРИМЕНЕНО" line. Either rewrite the check to compare against a genuinely new session (`readFresh()` works with the node-hid adapter, which implements `reopen()`), or downgrade the row to what it actually shows — "cache round-trip; device application not confirmed" — and keep the "не проверено" honesty the rest of §8 already has.

### 9. §9.5 states the rule "do not display 0", but specifies no mechanism, and the shipped page violates it

**Severity:** Major
**Affected Scope:** §9.5 (lines 291–294), §6/§7 description of the page

**Finding & Guidance:**
The rule is correct and important: output volume is not readable until the physical knob is moved, and "Показывать «0» нельзя — это будет ложь в опасную сторону: ноль означает mute, а выход может быть на максимуме."

The document then gives the implementer no required rendering for the unknown state, and the page it documents already shows the forbidden value: `web/index.html:84` declares `<input type="range" id="oHpVol" min="0" max="99" value="0" disabled>`, and `render()` only updates it when the value is known (`:235–236`, `if (hpVol !== null)`). So after connecting, `enableControls(true)` (`:305–309`) enables a slider whose thumb sits at 0 while the text label shows `—`. The first drag then sends an absolute volume derived from a position the user was never shown.

Specify the contract: the control stays disabled until `0x64:03` first arrives; the unknown state renders no numeric position at all; the label reads a fixed token; and state explicitly what the first user gesture is allowed to do (send an absolute value chosen from a safe default, or refuse until a read arrives). This is a design decision, not a detail — the current page made it silently.

### 10. Static hosting is offered as an equal alternative without the URL-layout contract that makes it work

**Severity:** Major
**Affected Scope:** §2 A (line 31), §3 (lines 96–98)

**Finding & Guidance:**
§3 says the server can be dropped entirely and the page served from a static host. The page cannot be deployed that way without knowing two facts the document omits.

First, its imports are root-absolute: `import { M62TransportCore } from '/src/transport-core.js';` and five more (`web/index.html:159–164`). They resolve only when the site root maps `/src/*` to the repository's `src/` — the exact mapping `src/server.js` implements (`STATIC_DIRS = ['web','src']`, `src/server.js:242`, with `/` rewritten to `/web/index.html`, `:272–276`). Uploading the `web/` directory alone, which is what "один файл, без сборки" invites, yields a page with six 404s.

Second, the set of modules the page actually needs is not listed anywhere, and it is not the same as "the domain modules are clean": `transport-core.js`, `transport-consts.js`, `protocol.js`, `crc16.js`, `adapter-webhid.js`, `eq-hid.js`, `comp-hid.js`, `reverb-hid.js`, `phantom-hid.js` — and `mixer-tags.js`/`duck-loopback-hid.js` as soon as §6's remaining items are built. Write the deployment contract: required root layout, required file set, and whether subpath hosting is supported at all (with the absolute imports as written, it is not).

### 11. The DFU-safety guarantee is described more strongly than the code provides

**Severity:** Major
**Affected Scope:** §5 (lines 142–148)

**Finding & Guidance:**
The document says the protection lives in the adapter: "Фильтр по vendor-интерфейсу и проверку `collections[].interface === 4` делает `adapter-webhid.js` (`pickVendorInterface`)." Presented as the answer to "можно превратить карту в кирпич", it is incomplete for both adapters.

- `src/adapter-webhid.js:69–83`: after the `interface === 4` loop, `pickVendorInterface` falls back to "the first device with any reports" and then to `list[0]`. `requestDevice()` (`:51–57`) asks the browser with `filters: [{ vendorId: VID, productId: PID }, { vendorId: VID }]` and then passes the returned list to that function — so a non-vendor collection can be selected when `interface` is absent, which is the very case the fallback was written for.
- `src/adapter-nodehid.js:21–22`: `const vendor = candidates.find((d) => d.interface === VENDOR_INTERFACE); const chosen = vendor ?? candidates[0];` — path B will open `candidates[0]` when interface 4 is not among them.

State the contract instead of the implementation summary: the adapter must refuse to open unless vendor interface 4 is positively identified, no fallback to "first device" is permitted, and an unidentified device is an error the UI surfaces. Then require the same of path B's adapter. As written, an implementer copying the described pattern reproduces the unsafe fallback.

---

## Nits

### 12. §6's output address column does not match the pair rule

**Severity:** Nit
**Affected Scope:** §6, line 191

The row reads "Выходы | громкость HP, MUTE HP/OTG | `0x63/0x64:03`, `0x61..0x64:04`". The second range spans four addresses, while the actual pairs are `0x63/0x64:04` (HP mute) and `0x61/0x62:04` (OTG mute) — see `web/index.html:381–393` and the assertions in `src/tools/test-ui-frames.js:64–79`. Use `0x63/0x64:04` and `0x61/0x62:04`. The pair rule is stated elsewhere, so this is a notation defect rather than a wrong instruction, but it is the kind of range that gets copied literally.

### 13. §10's "третий скрипт" points at the wrong step number

**Severity:** Nit
**Affected Scope:** §10, lines 309–330

"Порядок важен: третий скрипт требует запущенного сервера." The numbered step 3 *is* the server; the script that needs it is step 4 (`test-browser-modules.js --port 8898`). Counting only scripts makes the sentence technically true but the reader is looking at step numbers. Say "шаг 4" or renumber so the server start is step 0.

### 14. The file the document points to still states the opposite of §5's "тонкость"

**Severity:** Nit
**Affected Scope:** §5 (lines 150–160) vs `src/transport-core.js:32–33`

Line 152 of §5 correctly says the periodic announce is "нужен **не для EQ**", and supports it with the measured 91/48/48 table. The header comment of the module §5 tells the reader to trust, `src/transport-core.js:33`, still says the opposite: "announce 0x11:0x26 каждые 15 с — без него EQ-блоки не приходят". An implementer who opens the cited file to check the claim finds it contradicted. Fix the comment, or add a line to §5 saying the comment is stale, so the two sources do not disagree.

### 15. The "0 dependencies" proof covers a much smaller graph than the claim implies

**Severity:** Nit
**Affected Scope:** §3 (lines 89–90), §8 line 250

§3 offers `test-browser-modules.js` as proof that "в графе импортов от `adapter-webhid.js` ноль `node:*`-модулей и ноль npm-пакетов", and attaches that proof to the separate claim that the domain modules are clean. But the graph is built from `ENTRY = 'src/adapter-webhid.js'` only (`src/tools/test-browser-modules.js:34`; page imports are listed at `:37–40` but are not traversed), and the graph it prints is two files: `adapter-webhid.js` and `transport-consts.js`. `transport-core.js`, `protocol.js` and `crc16.js` are never traversed, and `eq-hid.js`, `comp-hid.js`, `reverb-hid.js` and `phantom-hid.js` — six of the page's actual imports — are only imported to check that exports exist.

The modules are in fact Node-free (I checked their import specifiers), so nothing is broken; the defect is that the cited guarantee is weaker than the sentence it supports. Either make the test traverse from all six page imports and say so, or reword §3 to state exactly which entry point was checked.

---

## What holds up

For the record, so the author does not re-verify: the frame layout in §4 matches `src/protocol.js` (15 bytes, `22 33 | 20 01 01 | TT | PP | s32 BE | CRC16 | 66 77`); the keepalive period (2 s) and announce period (15 s) match `KEEPALIVE_MS` in `src/protocol.js:53` and `ANNOUNCE_MS` in `src/transport-core.js:52`; the "first announce only" measurement, the 91/48 address counts and the `__fromCache`/`__dumpComplete` flags match `src/transport-core.js:360–413`; the 61-route count matches the unique `url.pathname` literals in `src/server.js`; the reverb property map and the Bypass trap match `src/reverb-hid.js`; the EQ block/band/property numbering matches `src/eq-hid.js:59–63`; the 25/25 autonomy figure matches `src/tools/autonomy-behaviour.js` (25 routes) and `research/NOTES.md` §150; `test-ui-frames.js` really does pass 39/39; the 48 V confirmation text exists at `web/index.html:411–413`; and the registry-ACL statement in §9.6 is confirmed by `src/audio-params.js:210–219`.
