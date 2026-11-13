# Comprehension review — `docs/WEB-CLIENT.md`

Reviewer: egm-comprehension (Goldfish, fresh context). Mode: REVIEW.

Basis for every cross-check below: this document, `docs/STATUS.md` (the
given baseline), and direct inspection of the repository where a claim
needed a source. Nothing else.

---

## What this proposes

The document proposes a browser-only control surface for the TOPPING M62:
the visitor opens a page, connects the card, and configures it without
installing anything and without M Control Center (MCC). Because a remote
server has no physical path to the visitor's USB device, the protocol code
must execute in the visitor's browser and open the card through WebHID;
the server degrades to a static file host (path A, primary). A second,
subsidiary path B runs the identical protocol code over `node-hid` behind
a local agent. The code is split into layers — UI, transport policy
(`transport-core.js`), protocol framing, domain modules, optional server —
where the policy layer sees the device only as an adapter with
`write`/`onData`/`close`. Section 4 lists eight experimental protocol
rules whose violation produces a silent failure, section 5 enumerates what
the current UI can control, sections 6–9 cover safety, verification status,
user-facing limitations and open questions, and section 10 gives commands
to reproduce the checks.

## How the existing system works, per this document

A backend at `src/server.js` exposes 61 routes and is required only as a
static host for path A and as an agent for path B; the device is reached
over HID interface 4. Frames are built in `src/protocol.js` + `crc16.js`;
addresses and scales live in domain modules (`eq-hid`, `comp-hid`,
`reverb-hid`, `duck-loopback-hid`, `phantom-hid`, `mixer-tags`, `tags`),
which contain no Node dependencies. Session policy — handshake, subscribe,
keepalive, cache, EQ commit — is centralised in `transport-core.js`.
Existing verification tools are `test-transport-core.js`,
`test-browser-modules.js` and `test-ui-frames.js`. Mixer, loopback,
ducking and selectors are written but not read back, so their truth has to
be kept on the client side.

---

## Findings

### 1

- **Severity**: Major
- **Affected Scope**: §4 «Протокол: правила, которые нельзя нарушить», table rows (lines 108–117) and its closing claim (lines 119–120); §9 item 2 (lines 214–217).
- **Discrepancy Description & Rationale**: §4 opens by saying that violating any rule in the table yields a *silent* refusal, and closes by saying "Все эти правила собраны в `transport-core.js`". The table has eight rows and none of them states the one rule that governs the only block §9 asks the reader to build later: mixer writes (`0x31..0x3c`) take effect only inside the bulk-push bracket, and single writes to those addresses are ignored. In the repository that bracket is `0x11:0x20 = 1 … 0` (`transport-core.js#writeBulk`), and single writes to the mixer addresses are documented as ignored. §9 names "bulk-push, 200 кадров" without ever stating the constraint, and §4's table never mentions it. A reader who takes §4 at its word — the list is complete, so anything not listed can be written per-frame — sends the 200 mixer frames one by one and hits precisely the silent failure §4 promises cannot happen, with no row in the table to point at the cause. Either the bracket rule belongs in the table or the completeness claim in lines 119–120 must be withdrawn.

### 2

- **Severity**: Major
- **Affected Scope**: §4 rule "interface 3 (DFU) не трогать" (line 117) versus §3 «Границы, которые важны» (lines 85–87) and §2 path A (lines 32–37).
- **Discrepancy Description & Rationale**: §3 defines the boundary precisely: `transport-core.js` "получает адаптер с тремя методами: `write`, `onData`, `close`". Which physical device that adapter is bound to is decided *before* the core exists — for path A, §2 says the browser shows its own device chooser ("разрешение выдаётся на каждое устройство"). Therefore rule 8, the only rule whose violation destroys hardware, cannot be enforced by the modules §4 names; the only place it can live is the adapter/chooser, which §4 never mentions. As written, "чтобы вызывающий код не мог сделать неправильно" is false exactly where the consequence is a bricked card. The document should name the component that filters for the vendor interface and state that the core's guarantee starts after device selection.

### 3

- **Severity**: Major
- **Affected Scope**: §5 table, row «EQ» (line 135).
- **Discrepancy Description & Rationale**: The row reads "EQ | 4 полосы × enable/gain | 0x91..0x94". In the repository those four addresses are four *blocks*, not four bands on one channel: IN1 = `0x91`/`0x92`, IN2 = `0x93`/`0x94`, four bands per input, five properties per band (enable, type, gain, frequency, Q) — the "0x91..0x94 × 0x01..0x0a = 40" tag count the baseline states. The implemented page controls only IN1: its four sliders are built against `0x91`/`0x92` (`buildEqFrames('IN1', band, …)`), and `0x93`/`0x94` are never referenced. The row therefore (a) advertises an address range whose right half no UI writes, (b) hides the channel mapping the range encodes, and (c) presents enable/gain as the whole content of the blocks while type/frequency/Q sit in the same blocks and are not surfaced. A reviewer cannot answer "how many bands, on which inputs, which parameters are exposed?" and would wrongly approve IN2 EQ as covered.

### 4

- **Severity**: Major
- **Affected Scope**: §5 «Что умеет UI» table (lines 128–135) together with its closing «Не сделано» list (lines 137–138); §9 open question 2 (lines 214–217).
- **Discrepancy Description & Rationale**: The section presents two lists that read as exhaustive — six implemented groups and four unimplemented features. Headphone EQ (`0xa1..0xaa`, ten bands × two channels) falls in neither: it is absent from the table, absent from «Не сделано», and not mentioned anywhere else in the document. Per the baseline that block is fully reverse-engineered and writable over HID ("EQ наушников … HID читает и пишет — ПОЛНОСТЬЮ"), while the current page does not implement it. The reader is therefore left to infer that EQ coverage equals the four input blocks, and a work plan built from §5 omits a 20-band capability that needs UI work but no protocol work. Either list it under «Не сделано» or state that it is out of scope and why.

### 5

- **Severity**: Major
- **Affected Scope**: §8 items 4 and 5 (lines 198–204).
- **Discrepancy Description & Rationale**: Two adjacent items classify the same parameter — source selectors — in incompatible ways. Item 4 puts them among the parameters that "не читается обратно вообще", which is why the client "надо хранить у себя". Item 5 says the selectors are unknown only "до первого движения ручки" — i.e. that they do become known after that event, so they are readable conditionally rather than never. The reader cannot decide whether to implement local storage for selectors (§8.4) or to reconcile them against the device once the user has moved the control (§8.5), and the two answers produce different data models. If the conditional form is the correct one, item 4 needs the carve-out "кроме селекторов, которые приходят после первого изменения"; if not, item 5 must not imply a discovery path.

### 6

- **Severity**: Major
- **Affected Scope**: §7 «Проверено фактами», row «Бекенд автономен» (line 169); §2 path B «Плюсы» (line 55); §8 limitations (lines 186–204).
- **Discrepancy Description & Rationale**: The row claims "Бекенд автономен | 25/25 GET-маршрутов без MCC". The baseline records a different result for the same measurement — 25 GET routes checked, 24 working without MCC, 1 failing (`/api/audio-params`) — and separately states that sample rate and buffer size live in the Windows registry and are "в браузере недоступно принципиально", and that `GET`/`POST /api/audio-params` is one of the few things that requires a running MCC. `WEB-CLIENT.md` never names audio parameters, sample rate or buffer size anywhere. Its only gesture in that direction is line 55, which lists "реестр, службы Windows" as a path-B advantage without saying which feature it enables. Whichever of the two counts is current (the present code reads the sample rate from the registry, so the 25/25 may be the newer one), the document leaves a reader with two project documents that disagree about the backend's MCC independence, and with no statement at all that sample rate/buffer cannot be changed from a browser. That is exactly the kind of limitation §8 exists to record. The document must reconcile the count with the baseline and add the audio-parameter limitation to §8.

### 7

- **Severity**: Major
- **Affected Scope**: §10 «Как проверить самому» (lines 225–242) in relation to §7 (lines 160–169).
- **Discrepancy Description & Rationale**: Two problems with the reproduction recipe. (a) The second command, `node src/tools/test-browser-modules.js --port 8898`, requires a server already listening on that port — in the repository its final stage fetches `/` and every module in the import graph over HTTP and marks each as a separate check. The document lists the server start *after* it (line 238) and never states the dependency, so a reader executing the block top-to-bottom sees a batch of HTTP failures that look like a broken service rather than a missing prerequisite. (b) §7 asserts six verified facts, but §10 gives commands for only three. The page check ("headless Edge, DOM 23 395 байт") has no command at all: the only related artifact is `open-web-client.ps1`, a manual checklist that explicitly cannot verify the page headlessly (WebHID is absent there), and the document never mentions it. The static-serving check ("20/20: нужное 200, node-only 404, обход каталога 403") corresponds to no script in the repository; it was a one-off run recorded only in `research/NOTES.md` §154.5, which this document never references — it contains zero links of any kind. Two of six "проверено фактами" rows are thus not reproducible from this document, contradicting its own opening promise to contain "только то, что можно проверить". Either name the procedure, point at the script, or drop the rows from the verified table.

### 8

- **Severity**: Major
- **Affected Scope**: §4 (lines 110–117), §5 tables (lines 130–136), §7 row «Ядро работает…» (line 164), §9 item 2 (line 214).
- **Discrepancy Description & Rationale**: The document's core notation is never defined. `0x11:0x01`, `0x63/0x64:03`, `0x44:0b` — the `TT:PP` pair — is the unit of discussion from §4 onward, but the document never says what the two fields are, what a "кадр" is, or what "тег" means in "44 тега вместо 96". The reader also meets three unexplained counts for the same object: "44 тега вместо 96" (§4), "92 адреса" (§7), and "96…102" in the baseline — with no statement of what is counted in each case (cached addresses, received reports, announced properties). "дамп" is introduced as a mechanism without saying what a dump is, and "bulk-push" / "брекет" appear only in §9, undefined. A reader cannot verify a single address in §5, the section a reviewer is expected to check first.

### 9

- **Severity**: Major
- **Affected Scope**: §4 table rows 3 and 5 (lines 112, 114).
- **Discrepancy Description & Rationale**: Two adjacent rows describe the same opcode with opposite effects and two different notations. Row 3: "announce `0x11:0x26` каждые 15 с | без него EQ-блоки не приходят". Row 5: "читать EQ только через дамп `0x11:26` | обычный ANNOUNCE блоки EQ не несёт". A reader cannot reconcile them: one says announce is what makes EQ blocks arrive, the next says ordinary announce does not carry EQ blocks. The underlying distinction — that the EQ payload rides only the first announce of a session (the baseline's "ловушка 1": 101 tags on the first, 46 on the second) — is exactly the fact a naive implementer needs and it appears nowhere. The two spellings `0x11:0x26` and `0x11:26` for one value compound the confusion. State once that announce triggers a dump, and that only the first one in a session carries the EQ blocks.

### 10

- **Severity**: Major
- **Affected Scope**: §5 (whole), §4 table (whole), §8 items 3–4.
- **Discrepancy Description & Rationale**: The device is multimode — the baseline tracks modes as a first-class coverage row ("РЕЖИМЫ … но смена идёт через MCC") — and the mode changes which blocks exist: input EQ is absent in Mobile and Prof, effects/reverb are absent in Prof, and the mixer has five buses in Live, three in Prof and none in Mobile. `WEB-CLIENT.md` never uses the word "режим" and states all of §4's rules and all of §5's capabilities unconditionally: "EQ 4 полосы", реверб and the planned mixer "5 шин × 11 источников" read as always addressable. A reader building against §5 hardcodes address families that are simply absent on a card in another mode, and reads "молчаливый отказ" (§4) as a protocol fault when the real cause is the mode. At minimum the document must state which mode every §5/§7 result was obtained in and how the client detects the mode, or declare mode support out of scope.

### 11

- **Severity**: Major
- **Affected Scope**: §5 line 137 («сохранение сцен»), §8 item 4 ("селекторы"), §9 items 1–2, §5 line 138 ("loopback (4 пары)"), §6 item 2 ("джек").
- **Discrepancy Description & Rationale**: Several load-bearing nouns are used without definition and are not standard engineering vocabulary. "Сцена" appears twice and is the subject of an open decision in §9.1, yet the document never says what a scene contains — a full snapshot of every parameter, one effects block, or the device-side Chat/Vocal scenes the repository addresses as `0x45:0x01`/`0x45:0x02`. That collision decides §9.1: if scenes are device-side, the choice between `localStorage` and the server is a different question entirely. "Селектор" is used in §8 without saying what it selects. "Пара" in "4 пары" and in §4's "ОБА адреса пары" is undefined — the reader must guess it means the left/right group pair of one stereo channel. "Джек" in §6.2 is not tied to a connector: the card has several (HP, OTG, IN1/IN2, AUX, BT per the baseline's jack tags), and whether the warning fires for the headphone jack or for any input changes how the UI must read the state.

---

### 12

- **Severity**: Nit
- **Affected Scope**: §2 path A, «Плюсы» (lines 40–41).
- **Discrepancy Description & Rationale**: "сервер можно выключить после загрузки страницы" is true only until the next reload: §3 states the UI is a single file without a build, but the page's protocol code lives in `src/*.js` modules fetched at load time, so the server is needed for every page load. A reader may conclude the deliverable is a self-contained artifact that can be copied to static hosting once, and be surprised by a blank page after a refresh. One clause fixes it: "до следующей перезагрузки страницы".

### 13

- **Severity**: Nit
- **Affected Scope**: §5 address column (lines 130–136).
- **Discrepancy Description & Rationale**: The column mixes three notations without saying so: a full address (`0x63/0x64:03`), a shorthand listing only properties after the first (`0x44:0b, 08, 09, 0a, 0f`), and a range (`0x61..0x64:04`). The range is the misleading one: `0x61..0x64` is two pairs with different meanings (OTG mute on `0x61`/`0x62`, HP mute on `0x63`/`0x64`), and §4 already tells the reader that writing one member of a pair is wrong. A reviewer comparing the table to the code cannot tell which of the four targets each mute is meant for.

### 14

- **Severity**: Nit
- **Affected Scope**: §3 «Это проверяемо» (lines 89–94) and §7 row «Клиентские модули без Node» (line 165).
- **Discrepancy Description & Rationale**: The evidence pointer is narrower than the claim it supports. The claim covers `eq-hid.js`, `comp-hid.js` "и остальные" domain modules, but the cited check is "в графе импортов от `adapter-webhid.js`" — and that graph contains only the adapter and its constants module; domain modules are never in it. The page imports four domain modules (`eq-hid`, `comp-hid`, `reverb-hid`, `phantom-hid`) that the cited graph does not traverse, so the sentence proves less than it states. The same applies to §7's "0 зависимостей", which reads as "no imports at all" while it means "no `node:*` modules and no npm packages in that one graph".

### 15

- **Severity**: Nit
- **Affected Scope**: §3 layer diagram "Сервер `src/server.js` (61 маршрут)" (line 79); §7 «25/25 GET-маршрутов» (line 169); §6.
- **Discrepancy Description & Rationale**: Three different route counts are in play across the project documentation — 61 here, 25 GET routes in §7, 48 endpoints in the baseline — with no reconciliation of units (all routes vs GET-only vs documented endpoints). A reader with the baseline open cannot tell whether the server grew, whether the numbers count different things, or whether one document is stale. One sentence defining the unit ("61 маршрут — все методы; из них 25 GET") removes the ambiguity.

---

## Summary

Blocker: 0 — the document is actionable as written; the architecture, its
boundaries and its safety rules can be understood and reviewed.
Major: 11 — each changes what a reader would build or approve.
Nit: 4 — notation and polish.
