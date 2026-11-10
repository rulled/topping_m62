# Implementation Readiness Review — `docs/ARCHITECTURE.md`

**Reviewer:** `implementation_readiness` (Goldfish, fresh context)
**Mode:** REVIEW
**Target:** `docs/ARCHITECTURE.md`, whole file (212 lines)
**Baseline consulted:** `docs/STATUS.md`, `research/WEBHID.md`, plus repository code the document cites
**Date:** 2026-11-10

**Result:** 3 Blocker, 6 Major, 3 Nit.

Scope note: the document states in its header that the decision is not yet made and that it exists "для проверки". That is legitimate for a decision memo, but it does not exempt it from the standard it is being audited against: the standard asks whether an engineer can execute the text and produce correct changes on the first attempt without guessing. Judged on that question, it currently cannot. The findings below are ordered by how early they stop an implementer.

---

## Blockers

### 1. No target scope, no phases, no per-file steps, no test plan

**Severity:** Blocker
**Affected Scope:** §4 (lines 106–125), §8 (lines 205–208), and the document as a whole

**Finding & Guidance:**
The standard requires four things of a document that is meant to be acted on: an explicit list of repository-relative file paths to create/modify/delete, precise logic changes per file, specific test cases with assertions, and a phasing where each phase leaves the codebase buildable and testable. None of the four is present. §4 gives prose ("ядро протокола переносится, обвязка — нет") and a bare list of module names; §8 ends with "маленькая страница, которая открывает устройство через WebHID, шлёт handshake и показывает громкости" — one sentence with no pass criterion, so the implementer cannot tell whether the experiment succeeded (does "success" mean ≥96 tags after handshake, or merely that a slider moves?).

The consequence is that the first implementer must invent the work breakdown: which directory the browser client lives in, whether the ported modules are copied, shared, or moved into a `src/core/` package, how the Node server keeps working off the same modules while the browser bundle also uses them, and what "готово" means for the spike. Each of those is an architectural decision the standard forbids leaving to the implementer.

The last point is concrete: the document's own recommendation ("это решение стоит принять до того, как начнётся фронтенд") makes the document a gate for the frontend, yet the gate has no definition of done. Add the missing four elements: exact paths (see finding 10 for the filename convention), the phase split (spike → state model → ported core → UI surface), the assertions for the spike, and the file-change list per phase.

### 2. "Ядро протокола переносится … без изменений" is false for `protocol.js`, and the portable-module list is incomplete

**Severity:** Blocker
**Affected Scope:** §4, lines 120–125

**Finding & Guidance:**
§4 asserts that `protocol.js`, `mixer-tags.js`, `eq-hid.js`, `comp-hid.js`, `reverb-hid.js`, `modes.js`, `tags.js`, `controls.js`, `settings.js` "не зависят от Node и переносятся в браузер без изменений". The claim holds for every module on that list except the first one, which is the most important of them.

`src/protocol.js:100–105`, in `withReportId()`, is:

```js
const out = Buffer.alloc(frame.length + 1);
out[0] = 0x00;
Buffer.from(frame).copy(out, 1);
```

`Buffer` is a Node global and does not exist in a browser. The function is also exactly the one the WebHID path needs (it produces the 16-byte report the transport writes), so it is not a dormant corner — it is on the critical path for every frame the browser will send. `parseReport()` is fine only because it already guards with `report instanceof Uint8Array`, but `withReportId()` must be rewritten to `Uint8Array` before any frame can be sent. That rewrite is a small, well-understood change, but the document tells the implementer no change is needed, which is the kind of statement that costs an afternoon at the first `ReferenceError: Buffer is not defined`.

The list is also incomplete in the other direction. The routes the document's own 85% figure depends on cannot run without modules that are absent from the list: `eq-scales.js` (used by `/api/eq/band` for rounding and ranges), `comp-scales.js` (compressor ranges/ratios), `eq-hp.js` (`/api/eq-hp`), `eq-mixer.js` (`/api/eq-mixer`), and the two service layers `controls-service.js` and `settings-service.js`, which hold the logic behind `/api/volume`, `/api/selector` and `/api/settings/*`. I checked the imports: `eq-scales.js`, `comp-scales.js`, `eq-hp.js`, `eq-mixer.js` and `controls-service.js` are genuinely Node-free, so they are portable and simply missing from a list that reads as exhaustive. `settings-service.js` is the interesting case — it is Node-free **except** for `setMode()` (`node:child_process` inside a dynamic import at lines 197 and 238, plus `process.platform` checks), i.e. only the mode-switch branch is non-portable and the toggle/enum/command logic is not. State that split explicitly; otherwise the implementer will either drop the settings service wholesale (losing most of the 85%) or drag `child_process` into the browser bundle.

Fix both halves in §4: replace the blanket "без изменений" with a per-module table (module → Node-dependent? → what the browser replacement is), and call out `withReportId()` as the one required edit in `protocol.js`.

### 3. The session bootstrap is under-specified — the document omits the second mandatory timer and the handshake ordering

**Severity:** Blocker
**Affected Scope:** §2 (lines 30–36), §6 R1 (lines 151–155), §8 (lines 205–208)

**Finding & Guidance:**
The document reduces keeping the device talking to one rule: "устройство замолкает без продления подписки каждые 2 с" (§2). The actual bootstrap in `src/transport.js` is three sends plus a second timer:

- `open()` sends handshake `0x11:0x01 = 1` **first**, then subscribe `0x11:0x24 = 1`, then announce `0x11:0x26 = 1` (`transport.js:111–124`);
- handshake being first is mandatory and is the single discovery the whole project rests on — `protocol.js:28–43` and `STATUS.md` both say that without it the device exposes 44 tags instead of 96, and that compressor `0x46:01..08`, input EQ `0x91..94` and EQ switches `0x9b:0f/10/12/13` never appear;
- `ANNOUNCE_MS = 15000` (`transport.js:40`, `162–168`): a *periodic* re-announce is required, because in Prof mode input EQ `0x91..94` and headphone EQ `0xa1..aa` only arrive after a **repeat** announce, roughly 19 s in (`transport.js:129–148`).

An implementer working from §2 alone will send subscribe every 2 s — which is exactly what the sample code in `research/WEBHID.md` §2 shows (`buildFrame(0x11, 0x24, 1)` on a 2 s interval, no handshake at all) — and will conclude that EQ is not available in the browser. That is a false conclusion that invalidates the document's central claim that 85% is reachable, and it is the most expensive way to fail.

Write the bootstrap as an ordered sequence with both timers distinguished: handshake once, subscribe every 2 s, announce at open and every 15 s, and note that a client that skips the periodic announce will see a device that looks like it has no EQ. §8's spike description should assert on this ("≥96 tags received, including `0x91:*` and `0xa1:*`"), not on "показывает громкости".

---

## Major

### 4. Mixer/loopback/ducking are presented as available without the write constraints that make them work

**Severity:** Major
**Affected Scope:** §2 lines 33–36, §4 lines 110–113, §5 line 139

**Finding & Guidance:**
§2 lists "микшер, loopback, ducking" among what works through WebHID. True — but only under constraints that the document never states and that a fresh implementer will violate on the first attempt:

- the mixer is **not** written frame by frame; `transport.js:289–330` documents that single frames are ignored and the matrix must be sent as a packet inside a bracket: `0x11:0x20 = 1`, then ~200 frames **in strict order**, then `0x11:0x20 = 0`, then `0x11:0x26 = 1`;
- order matters: `transport.js:302–303` says all 200 addresses and the order were matched against an MCC capture, and `mixer-tags.js` before line 180 records that a property-wise emit diverged from MCC on 180 of 200 positions;
- none of the three read back: `state-store.js:6–10` and `server.js:520–521` state `IN=0` for `0x31..3c`, `0x51..58`, `0x43`, so the device cannot confirm what was written and the client must model the state itself;
- a running MCC will overwrite the matrix from its own INI (`transport.js:305–309`), which directly contradicts §2's "Пользователь должен его закрыть" being framed only as an *open* conflict.

Item three is the one that changes the design: the document's own §4.2 says state moves to IndexedDB, but it never connects that sentence to "mixer is write-only", so an implementer may reasonably build a UI that reads the matrix back and shows zeros or stale values forever. Say explicitly, in §2 or §4, that the mixer/loopback/ducking state is client-owned, must be persisted, and must be re-sent on connect.

### 5. The 85% figure double-counts routes the document itself declares unavailable

**Severity:** Major
**Affected Scope:** §2 lines 33–41, §3 table line 98, §8 line 196

**Finding & Guidance:**
§2 cites "**53 из 62 маршрутов (85%)**", measured by `node src/tools/webhid-coverage.js`. I ran that tool: it does print 53/62. But the tool classifies by keyword presence in the route body, and its "МОЖНО ПОВТОРИТЬ В БРАУЗЕРЕ" list of 53 includes routes that §2 two paragraphs later declares unreachable:

- `GET /api/audio-params` and `POST /api/audio-params` — the document says "sample rate и buffer size — настройки USB-аудио через UIAutomation" are unavailable;
- `POST /api/eq/open`, `POST /api/compressor/open`, `POST /api/compressor/close` — the document says "открытие окон MCC — по определению" is unavailable.

Five routes. The device-only set is 48/62, not 53/62. The discrepancy is not academic: the 85% figure is then propagated into §3's decision table and into §8's recommendation ("85% функций работают без установки — это главная ценность идеи"), so the number that drives the choice is inflated by exactly the functionality the document is arguing is acceptable to lose.

Either recompute the number after excluding the UIAutomation routes, or state plainly that 85% is a route count that includes five routes the browser cannot reproduce, and give the corrected figure. Do not leave a reader to discover that the headline number contains its own counter-examples.

### 6. Variant B's "Покрытие: 100%" contradicts the project goal and the repository's own autonomy measurement

**Severity:** Major
**Affected Scope:** §1 lines 4–5 and 17–20, §3 line 98, §2 line 64, §8 lines 199–203

**Finding & Guidance:**
The document opens with the goal "сайт, где любой человек подключает свою M62 и управляет ею, **не устанавливая M Control Center**". `STATUS.md:10` states the same aim for the backend that already exists. Against that goal, §2's variant B claims "**Покрытие: 100%** — агент имеет доступ и к USB, и к файлам MCC", and §3 puts "100%" in the comparison table with "Профили MCC: да".

That 100% is only reachable by counting functionality that requires MCC to be **installed** (workspace profiles, `/api/workspace*`, `/api/state/import`) and, for mode switching, MCC to be **running** and then relaunched — `settings-service.js:192–250` stops MCC, sends `0x11:0x1d`, waits 16 s, and *starts MCC from `C:\Program Files\TOPPING Pro\...`*, because without it the device is left in an intermediate state (NOTES §86). `STATUS.md:86–110` measures the existing backend at 53/62 pure-HID routes, 7 needing MCC installed, 1 driving the MCC process, 1 clicking the MCC UI.

So the comparison in §3 sets 85% (no install) against 100% (MCC both installed and partly running) without saying that the second number depends on the software the project exists to avoid. A reader will pick B on coverage grounds and quietly re-import the dependency. Either define "покрытие" as "functionality that works with no MCC present at all" and restate B's number under that definition, or add the MCC-required rows to the table so the trade-off is visible. The table also has no row for sample rate / buffer size even though §2 and §8 both name it as one of the 15% — the two places disagree on what the missing 15% consists of.

### 7. The prescribed mitigation for background throttling does not address background throttling

**Severity:** Major
**Affected Scope:** §6 R1, lines 151–155

**Finding & Guidance:**
R1 states the risk correctly (a 2 s keepalive is throttled once the tab is hidden, the device goes silent) and then prescribes: "Web Worker с `setInterval` + запрос «не спи» через `navigator.wakeLock`".

`navigator.wakeLock` is the Screen Wake Lock API: it prevents the *screen* from dimming or locking, it is only grantable to a document that is active and visible, and a previously acquired lock is released automatically when the document becomes hidden ([MDN, Screen Wake Lock API](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API)). A backgrounded tab — the exact condition in the risk — cannot hold it. So the second half of the prescription cannot fire in the scenario it is meant to fix, and the document itself half-admits this ("тоже не всегда работает") without saying why.

The Web Worker half is directionally right but under-specified in a way that forces a design decision on the implementer: `navigator.hid` *is* exposed in dedicated workers (`[Exposed=(DedicatedWorker, ServiceWorker, Window)]` in the [WebHID specification](https://hid.spec.whatwg.org/)), but `requestDevice()` is `[Exposed=Window]` only. The implementer must therefore decide how the `HIDDevice` gets from the window (permission prompt) to the worker (keepalive), or use `getDevices()` inside the worker after the window-side grant. That handoff — and whether the worker is the sole owner of the device — is precisely the kind of choice the standard says must be pre-determined. Replace "лечится: Web Worker + wakeLock" with the concrete ownership model and a stated fallback for when both fail (e.g. "держим вкладку активной и предупреждаем пользователя"), since R1 itself says this must be solved before release.

### 8. The browser replacement for `state-store.js` is named but never specified, and the existing user data has no migration path

**Severity:** Major
**Affected Scope:** §4 lines 110–118, §7 item 2 lines 180–182, §211

**Finding & Guidance:**
§4 says `src/state-store.js` "в браузере не нужен", and that its role is "заменится на IndexedDB в браузере". Nothing else is said about the replacement. That leaves the implementer to design, from scratch: the IndexedDB schema (object stores, keys), a version/migration policy (the Node store has `STATE_VERSION = 1` and a documented atomic-save discipline, `state-store.js:51–52, 123–135`), the read semantics for a missing/corrupted record (the Node store recovers to an empty state with `source: 'corrupted: …'`, `state-store.js:116–120`), and the call-surface that the ported modules expect.

It also leaves existing user data unaddressed. Users of the current backend have real mixer/loopback/ducking content in `%APPDATA%\m62\state.json` — up to 5 buses × 11 sources plus 4 loopback pairs plus ducking values (`state-store.js:60–84`). Under variant A the browser has no filesystem access, so that state cannot be imported unless the user is asked to export/import a JSON file. The document's §7.2 discusses profile incompatibility with MCC but never the incompatibility with *its own current backend*, which is the only state a returning user actually has.

Add: the record schema (same shape as `state-store.js`'s `{version, mixer, loopback, ducking, prefs}` is an obvious, cheap choice), the migration path for `state.json` (a one-time export/import screen, or an explicit "this data is not carried over"), and the interface the ported code calls.

### 9. Non-obvious write/verify semantics that the browser client will silently get wrong are absent

**Severity:** Major
**Affected Scope:** §4 line 108–109 (what the transport does), §5 line 139

**Finding & Guidance:**
The document treats "держит HID" as the transport's only job. In `transport.js` it is also the owner of three behaviours that a fresh implementer cannot infer from the architecture text and that produce wrong UI state when missed:

- **Optimistic cache after write** (`transport.js:372–391`): the device does not acknowledge writes; the next announce is late and, for EQ, "только раз в сессию". Without updating the local cache the second read returns the *old* value and the client makes a wrong decision — the comment cites the exact failure ("реверб в Bypass, менять параметры нельзя", although the type was just enabled).
- **Reverb ordering trap** (`STATUS.md:132–136`): with `ReverbType = Bypass` the device silently ignores reverb parameter writes. Enable the type first, then write the parameters. A browser client that shows a reverb panel will display parameters that were never applied.
- **EQ arrives only on the first announce of a session** (`STATUS.md:126–130`): a "snapshot before / snapshot after" comparison inside one session always yields an empty second snapshot, which reads as a device refusal. Any "verify the write" feature built in the browser must not rely on that pattern.

None of this is Node-specific, so all of it migrates with the ported code — but the document never says the ported core includes these rules, and §4's framing ("обвязка — нет") suggests the opposite. List them as part of what the core owns, with the ordering constraint spelled out, or the implementer will rebuild them by trial and error against the hardware.

---

## Nits

### 10. Module names are given without repository-relative paths

**Severity:** Nit
**Affected Scope:** §4 lines 115–125

**Finding & Guidance:**
`protocol.js`, `transport.js`, `state-store.js` are bare filenames. The standard asks for exact repository-relative paths so a write allowlist can be enforced, and the rest of the repository habitually writes `src/protocol.js`, `src/transport.js` (as the document itself does for `src/tools/webhid-coverage.js` on line 33). Use `src/...` consistently in §4.

### 11. "Измерено" overstates what the coverage tool measured

**Severity:** Nit
**Affected Scope:** §2 line 33

**Finding & Guidance:**
"**Покрытие:** измерено `node src/tools/webhid-coverage.js`" presents the 85% as a measurement. The tool is a static read of `src/server.js` route bodies that buckets each route by which identifiers appear in it (`webhid-coverage.js:36–104`); it never opens a device or a browser, and its conclusion text is a hard-coded string. That is a defensible estimate, not a measurement. Say "оценено по составу маршрутов" and note the heuristic, especially since finding 5 shows the heuristic misclassifies five routes.

### 12. No pointers to the repository documents that contain the contract being described

**Severity:** Nit
**Affected Scope:** §2 line 30–31, §5, whole document

**Finding & Guidance:**
§2 says the browser needs `requestDevice()` by VID/PID, `device.open()` and `sendReport`, and stops there. It never says the report is sent with report id `0` and a 16-byte payload, that input arrives as 17 bytes with the report id and pad byte at each end, that `FeatureReportByteLength = 0` so `sendFeatureReport` is useless, or where the 15-byte frame layout lives. All of that is already written down in `research/WEBHID.md` §1–§2 and `docs/PROTOCOL.md`, and the document cites neither. A fresh implementer will not necessarily find them from an architecture memo. Add one "transport contract" paragraph with the byte layout and explicit references, rather than leaving the first frame to be reverse-engineered a second time.
