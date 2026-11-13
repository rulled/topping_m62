# Design Critic — REVIEW

**Target:** `docs/WEB-CLIENT.md` (242 lines, audited whole)
**Standard:** `feature-spec-standard.md` (Feature Specification Standard)
**Mode:** REVIEW

Basis for the audit (everything below is asserted only where I could reproduce it):

- Read the whole target document, `docs/STATUS.md`, the relevant sections of
  `docs/PROTOCOL.md` (lines 120–219) and `docs/API.md`.
- Read `src/transport-core.js`, `src/adapter-webhid.js`, `src/adapter-nodehid.js`,
  `src/phantom-hid.js`, `src/reverb-hid.js`, `src/eq-hid.js`, `src/protocol.js`,
  `src/transport-consts.js`.
- Read `web/index.html` control paths (handlers, EQ base targets, 48 V confirm).
- Read `src/server.js` static-serving block (lines 214–300) and CORS block (line 494).
- Ran `node src/tools/test-ui-frames.js` → **39/39**, as the document claims.
- Ran `node src/tools/test-browser-modules.js` twice: without a server on the
  given port → **19 passed, 3 failed**; with `src/server.js` listening on that
  port → **22/22**.
- Simulated `serveStatic()` path resolution in an isolated script, replicating
  `src/server.js:280-289` exactly, against encoded-prefix payloads.

---

## B1. §4 contradicts itself about `0x11:0x26` and drops the "first ANNOUNCE of the session" rule

**Severity:** Blocker
**Affected scope:** `docs/WEB-CLIENT.md:108-120` — the rule table, rows 3 and 5, and the closing claim.

**Finding.** Row 3 (line 112) says periodic `0x11:0x26` is mandatory because
"без него EQ-блоки не приходят". Row 5 (line 114) says "читать EQ только через
дамп `0x11:26` | обычный ANNOUNCE блоки EQ не несёт". Both rows are about the
same tag: one says it is how EQ arrives, the other says it is how EQ does not
arrive. The document never resolves this, and it is the normative section a
fresh reader will implement literally. There is no way to act on §4 as written
without inventing the missing distinction.

The distinction is documented everywhere else in the repo and is the single most
expensive trap the project hit: EQ blocks come **only on the first ANNOUNCE of a
session**; a repeated ANNOUNCE in the same session returns nothing
(`docs/STATUS.md:126-130`; `docs/PROTOCOL.md:130-148`; `src/eq-hid.js:38-47`;
`src/eq-hid.js:257`; `src/transport-core.js:321-336` comments). Without that
rule, a reader builds exactly the client that §4 forbids: write EQ, send
ANNOUNCE, read back, see nothing, and attribute the silence to device refusal —
the precise failure mode STATUS.md says cost a month of work.
`src/tools/test-transport-core.js:77,108-119` only reports a valid EQ read
because the cache accumulated it earlier, not because ANNOUNCE refreshed EQ.

**Recommendation.** Replace rows 3 and 5 with the measured rule and state the
consequence for the client:

- `0x11:0x26` at 15 s keeps the stream alive and is required for the *initial*
  EQ dump only once per session (`ANNOUNCE_MS = 15000`, `transport-core.js:52`).
- EQ (`0x91..0x94`) arrives on the **first** ANNOUNCE after connect; a repeated
  ANNOUNCE in the same session does not resend it, so "read after write" requires
  closing and reopening the session with a ≥ 500 ms gap (`PROTOCOL.md:212-215`).

Also state the observed dump timing (EQ at ~4.5 s after subscribe,
`docs/PROTOCOL.md:200-206`; usable snapshot 6–7 s, `docs/PROTOCOL.md:210-211`),
since §7's "запись EQ применена" evidence depends on it. Note that the existing
helper's window is shorter than the measurement — `readViaDump` waits at most
3.5 s (`src/transport-core.js:329-333`) while EQ lands at ~4.5 s.

Finally, define what a "dump read" returns, because the current helper makes the
rule unactionable: `readViaDump` calls `snapshot()`, which returns the **entire
cumulative cache** (`src/transport-core.js:242-244`) and is never cleared, and it
fires a *repeat* ANNOUNCE — the one the rule says resends nothing. In
`src/tools/test-transport-core.js:77,108-119` the `eqKeys >= 20` check therefore
passes on state captured by the first dump, not by the call under test. Any
client implementing "read EQ only via dump" needs the document to say: clear the
cache (or track a sequence number), then wait past the measured arrival time, then
decide — otherwise "read after write" silently compares the new intention
against an older snapshot.

---

## M1. The Alternatives Rule is not satisfied — no design is rejected, and the existing backend is never evaluated

**Severity:** Major
**Affected scope:** `docs/WEB-CLIENT.md:26-61` (§2, "Два способа добраться до карты"); §9 lists open questions but no rejected designs.

**Finding.** The standard makes an explicit alternatives evaluation mandatory and
fails a spec that "proposes a single path without proving that other viable
designs were considered and rejected for specific, documented reasons". §2 is not
an alternatives analysis: it presents A (WebHID) and B (local agent) side by side
with pros and cons for both, calls A "основной" and B "вспомогательный", and
explicitly keeps both ("Оба пути используют один и тот же код"). No option is
rejected, so no rejection rationale exists. Nothing is said about why path B
cannot be the only path, why a packaged desktop shell is out, why WebUSB was not
used, or why the HTTP backend that already exists and is marked ready
(`docs/STATUS.md:15`, `src/server.js`) should not simply be the UI — path B *is*
that backend, so the document is in effect choosing a second, parallel client
implementation without arguing why.

For a reader who has to decide what to build, this is decisive: A and B differ in
roughly an order of magnitude of maintenance cost (one shared transport core +
one adapter vs. a server, an install step, and a second deployment surface), and
the document gives no rule for choosing when to ship which.

**Recommendation.** Add an "Alternatives considered" section that (a) evaluates
"existing backend as the client" (path B only) against "static page + WebHID"
(path A only) against "both" on named axes: install friction, capability floor
(sample rate), test surface, security exposure, maintenance of two adapters;
(b) records an explicit decision with the reasoning; (c) states under what
condition the decision would be revisited (e.g. a capability that only B can
provide). Keep §9's open questions separate from rejected designs.

---

## M2. Device mode is never mentioned, though it gates the EQ and doubling the address count

**Severity:** Major
**Affected scope:** `docs/WEB-CLIENT.md:108-117` (§4 rules), `docs/WEB-CLIENT.md:186-204` (§8 limitations), `docs/WEB-CLIENT.md:124-138` (§5 capabilities).

**Finding.** The document describes a client that "настраивает карту" without
once stating which device mode that client runs in. Measured facts in the
repository: Mobile ≈ 95 addresses, Live ≈ 100, Prof 177; headphone EQ
(`0xa1..0xaa`) exists **only in Prof** (`docs/PROTOCOL.md:360`,
`docs/EQ-HP.md:17`); and reading a full state in Prof requires a snapshot of
26 s or more (`docs/PROTOCOL.md:146-148`). The doc's §5 EQ row and §7's "92
адреса" evidence are only meaningful against a mode, and §8's list of five
user-facing limitations omits mode entirely — the one limitation that changes
what the UI can even display.

Consequence for an implementer: they connect in Live, find no EQ blocks, and
conclude the device rejects EQ reads. That is the same class of false negative
§7 warns about, and the document gave them no way to distinguish it.

The current client is already blind to it in the same way: `web/index.html:52`
declares a `#mode` badge, and no code ever writes to it or removes its
`display:none`, so the page ships without showing the mode it is operating in.
A spec that does not mention mode cannot ask for that to be fixed.

**Recommendation.** Add a rule row and an §8 item: read the mode tag
(`0x11:0x1d`), show it in the UI, state the minimum address set per mode, and
state that full EQ behaviour is Prof-only with the corresponding snapshot
window. If mode switching is supported, name the frame (`0x11:0x1d`,
`docs/API.md:146`) and its reload side effect; if not, say so as a limitation.

---

## M3. §3/§4 claim the core makes misuse impossible; the two highest-risk rules are not enforced, and the cited evidence is self-referential

**Severity:** Major
**Affected scope:** `docs/WEB-CLIENT.md:119-120` ("Все эти правила собраны в `transport-core.js` … чтобы вызывающий код не мог сделать неправильно") and `docs/WEB-CLIENT.md:126`, `docs/WEB-CLIENT.md:167`.

**Finding.** Three separate problems, all provable:

1. **Pair rule (row 6, line 115) is not enforced in the core.**
   `src/transport-core.js:261-273` (`writeFrames`) sends whatever frames the
   caller passes; there is no helper that expands an output address into its
   pair, and `send()` (line 127) is public. The page writes both addresses by
   hand (`web/index.html:377,384,387,393`) — so correctness depends on the
   caller the document says cannot get it wrong. The repository's own live test
   writes a single address: `src/tools/test-transport-core.js:86`
   (`t.writeFrames([{ target: 0x64, prop: 0x04, value: 1 }])`), which is exactly
   the violation row 6 forbids.
2. **EQ commit rule (row 4, line 113) is opt-in.** `writeEqWithCommit`
   (`transport-core.js:306-319`) holds ≥ 2 s, but `writeFrames` does not, and
   nothing prevents an EQ write through `writeFrames`, which loses the write
   silently — the failure the document calls out as indistinguishable from
   device refusal.
3. **The 39/39 evidence does not cover the page's output code.** In
   `src/tools/test-ui-frames.js` the output, mute and gain cases build the
   expected frames **inside the test** (lines 60-63, 67-70, 74-77, 85-88) and
   then assert them against themselves; the page's handlers are not imported.
   EQ, compressor, reverb and phantom cases do call the real builders
   (`eq-hid.js`, `comp-hid.js`, `reverb-hid.js`, `phantom-hid.js`), so those
   checks are genuine. §5's header ("Проверено сборкой кадров") and §7's
   "Кадры управления верны | 39 проверок" therefore overstate coverage for two
   of the six rows, one of which is the pair rule.

**Recommendation.** Either (a) reduce the claim to what the code does — "правила
собраны в доменных билдерах; маршруты записи в ядре не типизированы" — or
(b) actually enforce it: a builder that takes `(output, field, value)` and emits
both pair addresses, forbid raw `writeFrames` for output/EQ addresses (or route
EQ writes through the committing path only). Then make the test import the
page's handler module rather than restating its frames, so the 39/39 number
means what §5 says it means.

---

## M4. §5 claims EQ across `0x91..0x94`, but only IN1 EQ exists in the UI and IN2 is not listed as missing

**Severity:** Major
**Affected scope:** `docs/WEB-CLIENT.md:135` (EQ row) and `docs/WEB-CLIENT.md:137-138` ("Не сделано").

**Finding.** The EQ row advertises addresses `0x91..0x94` — i.e. both input
channels — under "Что умеет UI", and the "Не сделано" line does not mention
EQ. In the page, the EQ panel is titled "EQ входа IN 1" (`web/index.html:147`)
and the handler hard-codes `baseTarget = band <= 2 ? 0x91 : 0x92`
(`web/index.html:468-469`). `0x93`/`0x94` (IN2 channel, mapped in
`src/eq-hid.js:CHANNEL_BASE`) are never used by the UI. A reader takes §5 as the
capability inventory and would ship believing IN 2 EQ is done.

**Recommendation.** Split the row by channel and move IN2 EQ into "Не сделано"
(or implement it — the builders already support `buildEqFrames('IN2', …)`).
While there, state that the UI exposes only enable/gain of the five EQ fields,
so nobody assumes type/frequency/Q are covered by "4 полосы × enable/gain".

---

## M5. §7 certifies a server security property ("обход каталога 403, 20/20") that has no reproducer and whose mechanism resolves outside the root

**Severity:** Major
**Affected scope:** `docs/WEB-CLIENT.md:168`.

**Finding.** The row reads "Сервер не отдаёт лишнего | 20/20: нужное 200,
node-only 404, обход каталога 403". Those three sub-claims come from no single
tool, and two of them come from no tool at all:

- There is no tool in `src/tools/` that exercises static serving — searching the
  whole `src/` tree for `serveStatic`, `STATIC_DENY` or a static-path test
  returns only `src/server.js` itself. No such test exists.
- `test-robustness.js` does have exactly 20 `check()` calls, which is where the
  "20/20" number plausibly comes from — but it tests **API input validation**
  (`volume` with bad id, reverb with bad type, a nonexistent endpoint → 404), not
  file serving. It never requests a static file and never triggers the 403 branch.
- The only "нужное 200" checks over HTTP are in `test-browser-modules.js:159-170`,
  which fetches the page's module URLs from an already-running server; that file
  has a different total (22 with the server up, verified) and does not touch
  `node-only` or traversal either.

So the "20/20: 200 / 404 / 403" row is an unverifiable composite: the number is
real, the content it is attached to is not.

The mechanism it certifies is also weaker than claimed. `src/server.js:285-286`
confines with `abs.startsWith(STATIC_ROOT)`, a string-prefix test with no path
separator, on Windows. I replayed that logic exactly (decode → dir allowlist →
deny list → extension allowlist → `resolve(ROOT, '.' + rel)` → prefix test) and it
serves out of the root:

```
/web/..%5c..%5cTopping-backup%5cx.js
  => rel  = /web/..\..\Topping-backup\x.js
  => abs  = E:\Programming shit\Topping-backup\x.js
  => abs.startsWith("E:\Programming shit\Topping") === true  → 200
```

Any sibling directory whose absolute path begins with the root string (a
`Topping-backup`, `Topping-old`, `Toppings` directory — a plausible layout next
to a long-running research repo) is readable for whitelisted extensions. The
deny list is prefix-based too (`/src/server.js`), so it does not see such a path.

**Recommendation.** Do not publish a security claim that has no test, and do not
attach a real result from `test-robustness.js` to a different property. Either
delete the row, or split it: "Ошибки API | 20/20 (`test-robustness.js`)" and a
separately named static-serving test. Then say precisely what the static layer
does — "раздаются только `web/` и `src/`, только перечисленные расширения,
deny-лист модулей Node" — add a static path test with cases for encoded dots,
encoded backslashes, doubled separators and sibling-prefix directories, and fix
the guard to a boundary check (`abs === ROOT || abs.startsWith(ROOT + sep)`)
with the deny list applied to the normalised path.

---

## M6. Path B has no security model; the 48 V confirmation is a client-side courtesy, not a control

**Severity:** Major
**Affected scope:** `docs/WEB-CLIENT.md:45-59` (§2B), `docs/WEB-CLIENT.md:142-155` (§6), `docs/WEB-CLIENT.md:186-204` (§8).

**Finding.** The document presents the local agent as an ordinary option and
lists the 48 V `confirm()` as one of "три вещи, которые могут навредить". Both
statements are about the page; neither is a control. Measured:

- `src/server.js:494` sets `access-control-allow-origin: '*'`, with
  `allow-methods: GET,POST,OPTIONS` and `allow-headers: content-type`; there is
  no `Origin` check, no token, no auth anywhere in the server.
- `readBody` (`src/server.js:306-314`) parses whatever bytes arrive and never
  inspects `content-type`, so a cross-site `POST` with a `text/plain` body is a
  CORS-**simple** request: no preflight is even required, and the response is
  readable for the same wildcard reason.
- Therefore **any web page the user visits** can `POST http://127.0.0.1:8787/api/…`
  and operate the card — including `POST /api/phantom {on:true, confirm:true}`,
  because `confirm` is just a body field the server compares to `true`
  (`src/server.js:587-594`, then writes at `:598-600`). The `confirm()` dialog in
  `web/index.html:411` protects only the page's own button.
- §2A tells the operator to host the page publicly over HTTPS (§8.2). If path B
  is used from that page, the browser will call the localhost agent from a
  foreign origin — which the wildcard CORS makes permissible for **every other
  origin as well**.

None of this is discussed; §8's five limitations are about browsers, HTTPS, MCC
and read-back, and §6 is titled as protection.

**Recommendation.** Add a security section for path B and make its minimum bar
explicit: bind `127.0.0.1` only (`server.js:99` already does), enforce an
`Origin` allowlist, require a per-run token in a custom header (which forces a
preflight and defeats simple cross-site posts), and state plainly that
`confirm:true` is a UI convenience, not authorization. If path B is served to a
public origin, say what stops a third-party page from reaching the agent.

---

## M7. No acknowledgement channel is disclosed, so §6's "Заглушить" mitigation cannot be shown to work

**Severity:** Major
**Affected scope:** `docs/WEB-CLIENT.md:150-151` (§6 item 2), interacting with `docs/WEB-CLIENT.md:104-106` ("молчаливый отказ").

**Finding.** §4 states that a broken rule produces "молчаливый отказ — карта не
отвечает ошибкой, просто ничего не происходит", and §6 then rests a
hearing-damage mitigation on a button whose only evidence is the client's own
optimistic state:

- `writeFrames` returns `{ frames: n }` regardless of outcome
  (`src/transport-core.js:261-273`).
- The page calls it with `{ updateCache: true }` (`web/index.html:192`), and the
  core writes the intended value straight into the cache
  (`src/transport-core.js:265-270`) — so the cache no longer reflects the device
  but the last intention. `render()` then reads the cache through `g()`
  (`web/index.html:220`), and the HP warning banner clears on
  `t.get(0x64,0x04) !== 1` (`web/index.html:228`). If the mute write is silently
  ignored, the client hides the safety warning anyway.
- `send()` logs `→ label` in the `ok` channel immediately, with no
  acknowledgement check (`web/index.html:189-199`).

There is no read-back path specified in the document and no latency budget for
one. So §6's item 2 cannot be distinguished from a decorative button: the
document never defines what "заглушено" means or how the UI learns otherwise,
while §4 guarantees the one failure mode in which nothing happens.

**Recommendation.** Specify the confirmation policy for writes the document
treats as safety-critical (mute, 48 V, gains): write → observe the tag in a real
device report → only then update UI state; keep optimistic cache updates out of
safety-critical fields, or mark them "не подтверждено". State the maximum wait
(announce interval 15 s, dump ~4.5 s) and what the UI shows meanwhile. Extend §4
with "acknowledgement is asynchronous; success means tag observed in a device
report", since §4 and §6 currently assume opposite things about it.

---

## M8. The document is undated and its key numbers conflict with the only dated baseline, with no method given

**Severity:** Major
**Affected scope:** `docs/WEB-CLIENT.md` (whole file — no date/version header), specifically `docs/WEB-CLIENT.md:79` ("61 маршрут"), `docs/WEB-CLIENT.md:169` ("25/25 GET-маршрутов без MCC"), `docs/WEB-CLIENT.md:164` ("92 адреса").

**Finding.** Every number in §7 is a measurement, yet the file carries no date,
no baseline revision, and no count method. The baseline this review was given
(`docs/STATUS.md`, stated "актуально на 2026-11-08") disagrees on both headline
figures:

- Autonomy: STATUS records `GET-маршрутов проверено: 25 / работают без MCC: 24 /
  падает: 1 (/api/audio-params)` (`STATUS.md:81-84`). The target document claims
  25/25. Only `research/NOTES.md:8935` ("стало: работает 25 из 25") supports the
  newer figure — a source the target document does not cite.
- Route count: STATUS says "48 эндпоинтов" (`STATUS.md:15`); the target says 61.
  Counting `server.js` gives 61 unique pathnames but 69 method+path pairs, so
  the target's number is reproducible only under an unstated definition.

A fresh reader cannot adjudicate either conflict from the document itself, which
is precisely the reader the standard asks the spec to serve.

**Recommendation.** Add a header with date, baseline commit/round, and the
command used per number; cite `research/NOTES.md` where it supersedes STATUS, or
drop the conflicting numbers. Define "маршрут" once (pathname vs method+path).

---

## M9. §8's user-facing limitations omit the one capability the browser provably cannot deliver

**Severity:** Major
**Affected scope:** `docs/WEB-CLIENT.md:186-204` (§8), `docs/WEB-CLIENT.md:54-55` (§2B pluses), `docs/WEB-CLIENT.md:208-221` (§9).

**Finding.** The stated promise is "владелец открывает страницу… настраивает её.
Ничего не устанавливая" (§1). §8 then lists browser support, HTTPS, MCC
exclusivity, persistence and unreadable parameters — but not sample rate / buffer
size, which per the baseline is a hard dead end for a browser client: "**Не
протокол M62.** WAVEFORMATEX в реестре Windows… В браузере недоступно
принципиально" (`STATUS.md:164`). §2B's plus list gestures at it
("реестр, службы Windows") without saying that this needs elevation and an audio
service restart, so the reader cannot tell that a whole capability class lives
only on path B — and therefore cannot use §8 to answer "what do I lose by
choosing A". §9 does not carry it as an open question either.

**Recommendation.** Add to §8: the browser path cannot change sample rate or
buffer size (registry + audio-service restart, Windows only, needs elevation),
with the consequence for the product statement in §1. If the answer is "not in
scope", say so as a non-goal in the goals/non-goals section instead of leaving it
unstated.

---

## N1. §10 lists the verification commands in an order that cannot produce the stated results

**Severity:** Nit
**Affected scope:** `docs/WEB-CLIENT.md:225-242`.

**Finding.** The commands run `test-browser-modules.js --port 8898` (line 232)
before the server is started on 8898 (line 238). That tool fetches the page's
module URLs from that server (`test-browser-modules.js:159-170`), so in the
documented order it ends **19 passed / 3 failed** (verified). The stated
"22/22" is reachable only with the server already running.

**Recommendation.** Move the server start above the module test, or note that
this command requires the server on the same port. Keep the expected figures
next to each command so a reader can tell a real failure from a wrong order.

---

## N2. Session exclusivity is stated for MCC only, though it applies to any second client, including a second tab

**Severity:** Nit
**Affected scope:** `docs/WEB-CLIENT.md:194-196` (§8 item 3).

**Finding.** The item explains that MCC occupies the device and that two programs
overwrite each other's settings. The same constraint holds for two instances of
the client itself: the protocol has one session per device, a second connection
takes it over, and reconnecting within 500 ms is treated as the same session and
yields no full dump (`docs/PROTOCOL.md:212-215`; `docs/STATUS.md:126-130`). The
document recommends no lock, no cross-tab guard, and does not warn that a second
tab silently degrades the first one's state stream.

**Recommendation.** Extend item 3: one open client per device, worth an explicit
"уже открыто в другой вкладке" guard via `localStorage`/`BroadcastChannel`, and
note the ≥ 500 ms reconnect gap as a client requirement rather than a protocol
trivia.

---

## Verified as stated (not defects — recorded so the author need not re-check)

- §5 reverb, compressor and phantom address maps match code exactly
  (`src/reverb-hid.js`, `src/comp-hid.js`, `src/phantom-hid.js`); the 48 V frame
  is `0x21/0x22:0x03` as written.
- §5 "39/39" reproduces (`node src/tools/test-ui-frames.js` → 39 passed, 0 failed);
  §10's "22/22" reproduces when the server is running on the stated port, and
  "5/5" matches the five assertions in `test-transport-core.js:130-136`.
- §7's "Сервер не отдаёт лишнего | 20/20" number matches `test-robustness.js`
  (exactly 20 `check()` calls), but that tool tests API input validation, not
  static serving, so it does not support the 200/404/403 clause attached to it
  (see M5).
- §3's "ноль `node:*` и ноль npm-пакетов" is real: the client graph is
  `adapter-webhid → transport-consts`, `transport-core → protocol → crc16`, plus
  `duck-loopback-hid → mixer-tags`.
- §4 keepalive (2 s) and handshake-first ordering match `protocol.js`
  (`KEEPALIVE_MS = 2000`) and `transport-core.js:147-161`.
- §6 items 1 and 2 exist in the page: the 48 V dialog (`index.html:411`) and the
  jack/mute warning banner (`index.html:228`).
- §2A browser matrix and the HTTPS/localhost requirement match
  `adapter-webhid.js:9-13`.
- §7's "НЕ проверено" table is honest about the WebHID-on-hardware gap; that
  disclosure is not the problem — the missing mitigations above are.
