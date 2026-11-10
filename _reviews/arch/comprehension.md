# Comprehension review — `docs/ARCHITECTURE.md`

Reviewer: Comprehension Goldfish (naive reader, no project history, no memory of writing this)
Mode: REVIEW
Document audited: `docs/ARCHITECTURE.md`, whole file (212 lines)
Baselines read: `docs/STATUS.md`, `research/WEBHID.md`

Terms used in this report, as I had to reconstruct them: **MCC** = M Control Center, the
vendor's Windows app; **WebHID** = the browser API that lets a page talk to a HID device
directly; **HID interface 4** = the USB interface the M62 exposes, per the baseline.

---

## What this proposes

The project wants one page on the internet where any owner plugs in their M62 and uses it
without installing anything except a browser; because a remote server physically cannot see
the visitor's USB port, the document compares three ways to reach the device — **A** WebHID
in the page, **B** a small local agent at `http://127.0.0.1:<порт>`, **C** WebHID first with
the agent as a fallback. It scores A at 85% of the backend's routes, B at 100% (USB plus
MCC's files), and prices C as high complexity from maintaining two transport codebases.
It then argues that porting A is cheap: the protocol is plain bytes, nine named modules are
Node-free, and only the transport, the state file, the workspace reader and the UIAutomation
layer fall away. Five risks, four open questions, and a recommendation — A for the first
version, gated on a throwaway WebHID page that opens the device, sends the handshake and
shows volumes. My paraphrase is faithful to the argument but I could not reconstruct what a
"маршрут" is in this document's units, which is finding 1.

## How the existing system works, per this document

A local Node.js process finds the M62 on USB, opens HID interface 4 and speaks a
proprietary frame protocol; it additionally keeps mixer and loopback state in
`%APPDATA%\m62\state.json`, reads MCC's on-disk profiles, and still drives MCC's Windows
window for sample rate / buffer size and for opening the EQ and compressor dialogs. Of
the backend's 62 routes, 53 are considered reproducible by a browser and 9 are not,
which the document rounds to 85% and 15%. Reverse engineering is declared nearly finished
and transport-independent, because a frame is just bytes whether Node or Chrome sends it.
The document states twice that it does not choose, but §8 does recommend variant A and
names the probe that must succeed first.

**What I could not reconstruct from the text:** what a "маршрут" is (the word is never
defined and nothing is linked), and therefore how "53 из 62 маршрутов" becomes
"85% функций" and "да для 85%" of users. See finding 1.

---

## Findings

No Blocker. I could paraphrase every section, and the recommendation is executable in
outline (pick A, build the probe). The defects are in specification and evidence, not in
whether the document is comprehensible as a whole. One structural observation before the
list: the document contains **no links and no cross-references** to any sibling artifact —
not `docs/PROTOCOL.md`, not `docs/API.md`, not `docs/STATUS.md`, not `research/WEBHID.md` —
so every claim in it has to stand alone, and several of them are checked below against files
the reader is never told exist.

### 1. Severity: Major
**Affected Scope:** §2 «Вариант A» «Покрытие»/«Недоступно» (L33–41); §3 table (L98);
§8 (L196, L199–201).

**Discrepancy Description & Rationale.** The number the whole recommendation rests on is
built on an undefined unit and then silently changes unit three times. L33–34 says
coverage is "измерено" as **53 из 62 маршрутов (85%)**, but "маршрут" is never defined
anywhere in the document (no link to `docs/API.md` or `docs/BACKEND.md`, no example, no
count of the 53 or the 9). L196 then reads the same figure as "**85% функций**", and L102
uses it a third time as the answer to "«Просто зайти на сайт» — да для 85%", where 85% can
only mean users or a user experience. A route is neither a function nor a user: by the
document's own tooling each route is one HTTP handler, so `/api/health` and `/api/eq` weigh
the same. Nothing in the text justifies converting a route count into a functional share.

Worse, the excluded set is enumerated three different ways and none of them reconciles
with 15%. L38–41 lists three areas: MCC profiles, sample rate/buffer size, opening MCC
windows. L199 lists two: "профили MCC и sample rate". L98 lists only "Профили MCC".

The document does name its measuring tool — "измерено `node src/tools/webhid-coverage.js`"
(L33) — so the figure is reproducible in principle. It is worth saying what that tool
actually reports, because it does not support the three-item list. It buckets 8 routes as
"нужны файлы MCC" and one as "нужно окно MCC", and the 8 are not all profiles: two of them
are `GET /api/mode` and `POST /api/mode` (mode detection and switching), which L38–41 does
not mention at all. Worse, `POST /api/eq/open` and `POST /api/compressor/open` — which L41
classifies as "открытие окон MCC, по определению" and therefore unavailable — are counted
by the tool as **portable to the browser**, and so are `GET /api/audio-params` and
`POST /api/audio-params`, the document's own second exclusion (sample rate and buffer size,
which L40 says need UIAutomation). The mechanism is visible in the tool: it strips every
`try/catch` block before matching, so any route whose whole body sits inside one falls into
the "portable" bucket regardless of what it calls. That is exactly the shape of `eq/open`,
`compressor/open` and both `audio-params` handlers.

So the "15%" is a count of HTTP handlers whose composition contradicts the prose that
explains it, in both directions: things the prose calls impossible are inside the 85%, and
things outside the 85% are not the three areas listed. A reader cannot reconcile the number
with the description, and the description is what the recommendation is argued from.

The same tool also puts into that 85% several handlers whose backend work is local file
I/O, not HID: `POST /api/state/mixer`, `/api/state/loopback`, `/api/state/ducking` write
`%APPDATA%\m62\state.json`; `/api/snapshots*` write `research\snapshots`; `/api/state/import`
reads MCC's workspace. §4 of this document itself says the state store must be rebuilt on
IndexedDB, so "85% переносится" is really a mix of "works after copying the module" and
"works after designing a new state layer" — and §4's own conclusion ("ядро переносится,
обвязка — нет") is the more honest split. A reader who takes 85% as "85% of the work is
already done" will under-budget the frontend by exactly the amount §4 warns about.

Finally, the document never says whether "100%" means *parity with the current backend*
or *everything the target user needs*. That distinction is decisive, because two of the
three excluded areas — sample rate by UIAutomation and opening MCC windows — are MCC
machinery, not product features: a browser client has no MCC window to open and no
reason to want one. Counting them as "недоступно" inflates the shortfall with things the
target user never asked for. §8 implicitly switches to the user-need reading when it
rules the 15% acceptable (L199–201), without saying that it switched.

Fix: define "маршрут" in one line, enumerate or link the 53/9, state the unit explicitly
("доля HTTP-обработчиков бекенда, а не функций и не пользователей"), and pick one
definition of the target before computing any percentage.

### 2. Severity: Major
**Affected Scope:** §2 «Вариант B» (L60–70, especially L64 and L67); §3 table (L98);
contrasted with the stated goal (L4–5) and L38–41.

**Discrepancy Description & Rationale.** B is credited with "**Покрытие: 100%**" on the
grounds that "агент имеет доступ и к USB, и к файлам MCC" (L64), and its plus list adds
"всё работает, включая профили и **sample rate**" (L67). But the document itself, twenty
lines earlier, classifies sample rate and buffer size as reachable neither by HID nor by
files: "sample rate и buffer size — настройки USB-аудио через UIAutomation" (L40). An
agent is USB access plus filesystem access plus, if it keeps `ui-control.js`, the ability
to drive a window — and there is no MCC window unless MCC is installed and running.

So B's 100% is not "100% of the functionality" but "100% of it *while keeping MCC*", and
the document never says that. This matters directly against the project's own goal, stated
on line 4–5: a site where the user manages the device "**не устанавливая M Control
Center**". Under that goal, B's sample-rate capability is not a feature — it is the
dependency the project exists to remove, re-imported. The same holds for "профили" (L67):
profiles are MCC files, so B needs MCC installed.

Compounding it, §8 justifies choosing A partly by conceding sample rate — "sample rate —
редкая настройка, ей можно пожертвовать" (L199–201) — which reads as if B would have
recovered it. Neither the table (L98) nor the prose tells the reader that on this item A
and B are in the same position: A drops it, B keeps it only by keeping MCC. A reader
choosing between the two on the "100% vs 85%" contrast is choosing on a number that means
something different in each column. Variant C inherits the same wrong cell: L98 gives it
100% and "Профили MCC: да", which is true only after the user has installed the agent.

Fix: state in B's box that profiles and sample rate work only with MCC installed/running,
and adjust the coverage figure (or the goal wording) so the two can both be true.

### 3. Severity: Major
**Affected Scope:** §2 «Вариант A» (L33–36); §3 (L98); vs the project's existing WebHID
research.

**Discrepancy Description & Rationale.** The document reverses the conclusion the project
already recorded and never says so. `research/WEBHID.md` — same device, same API, written
three days earlier — concludes: "WebHID технически возможен, но даёт только ~40%
функционала" (§5), lists mixer, EQ, loopback, outputs, compressor and reverb as things
WebHID "**НЕ ДОСТАТЬ и НЕ ЗАПИСАТЬ**" (§3.6, §4), and recommends "**Основной путь —
бекенд** (Node)" with WebHID as a "бонус «без установки»". ARCHITECTURE now claims 85%
including EQ input, EQ headphones, compressor, reverb, mixer, loopback, ducking and
effects, and recommends the exact opposite.

The reversal is probably justified — the baseline does record that EQ input, compressor and
reverb were moved to direct HID writes on 2026-11-10 — but the document neither says that
`WEBHID.md` §5 is stale nor points at the section that supersedes it. A reader who has both
files in the repository has no way to decide which one is current: they are three days
apart, same device, same API, and they disagree by a factor of two. §7 "Что не решено"
lists the variant choice but not this contradiction.

This is not hypothetical bookkeeping. The two documents imply opposite recommendations
("основной путь — бекенд" vs "вариант A для первой версии"), and the 85% that carries
ARCHITECTURE's whole argument is exactly the figure the other document contradicts. One
sentence — "прежняя оценка 40% устарела: EQ, компрессор и реверб пишутся через HID" —
would close it.

Fix: add that sentence to §2A and a "superseded by `docs/ARCHITECTURE.md`" note at the top
of `research/WEBHID.md`.

### 4. Severity: Major
**Affected Scope:** §2 «Вариант A» «Что нужно» (L30–31); §8 (L205–207); the phrase
"подписка" (L53).

**Discrepancy Description & Rationale.** The document describes the whole browser
pipeline as "`navigator.hid.requestDevice()` по VID/PID … затем `device.open()` и
`sendReport`" (L30–31), and the gate before all further work as "маленькая страница,
которая открывает устройство через WebHID, **шлёт handshake** и показывает громкости"
(L205–207). The mandatory session handshake is never specified: not its tag, not its
value, not that it is required at all, not what happens without it. The word appears
once, in the last section, with no frame and no link.

The baseline makes this the single most important fact about the device: "**Без него
устройство отдаёт 44 параметра, с ним — 96…102**", and the project spent a month
concluding that the compressor and EQ were unreachable because of that omission
(`STATUS.md` «Главное открытие: session handshake»). A reader who follows §8 literally
and sends subscribe only will see a working volume page — and no compressor, no EQ, no
effect meters — which is precisely the false conclusion the project already paid for.

The same hole covers "подписка": L53 says the device goes silent without renewal "каждые
2 с", but the document never says that renewal is a *different* message from the
handshake (subscribe vs announce), so a reader cannot tell what to send every two
seconds, or whether the browser needs both timers or one.

Fix: three lines in §2A — handshake `0x11:0x01 = 1` is mandatory before anything else;
subscribe `0x11:0x24 = 1` every 2 s keeps the stream alive; announce `0x11:0x26` exists
and is separate — with a pointer to `docs/PROTOCOL.md`.

### 5. Severity: Major
**Affected Scope:** §5 table "Осталось отреверсить" (L135–145); §2A carries the same
claim (L35); §8 (L197–198).

**Discrepancy Description & Rationale.** The table is presented as the complete remaining
work ("Осталось отреверсить (не зависит от варианта)") and closes by saying all three
non-firmware items are needed in every variant (L144–145). But the baseline's coverage map
still has five blocks below 100%: compressor 95%, reverb 80%, noise reduction 75%,
ducking 75%, 48V 40%. The table lists ducking (as "применение записи") and drops noise
reduction and 48V entirely, while §8 asserts "реверс уже позволяет это: EQ, компрессор,
**реверб**, микшер пишутся через HID" (L197–198).

Reverb is the sharper case, though not because the capability is missing: the project did
solve it (`reverb-hid.js` carries a confirmed tag map dated 2026-11-10), and this document
is right that reverb goes over HID. The defect is that the document omits the one condition
that makes reverb writes work, which `STATUS.md` records as a trap that already cost a false
conclusion: "**Параметры реверба не применяются при `ReverbType = Bypass`.** Устройство
молча игнорирует запись… Правильный порядок: включить тип, потом параметры." §2A tells the
reader reverb is in the 85% and stops there. A frontend implementer who sends room/decay/
width to a device sitting in Bypass gets silent no-ops and will report "WebHID can't write
reverb" — the same wrong turn, one layer up. For a document whose §8 gate is a probe meant
to settle exactly this class of question, a mandatory ordering constraint on a block it
counts as covered belongs in the text.

Second gap in the same table: noise reduction (baseline 75%, "уровень + тип расшифрованы")
and 48V (40%, "только через INI, в HID нет") are absent from a table titled "Осталось
отреверсить" and are then rendered invisible by §5's closing claim that only these rows
remain. If they are deliberately out of scope for the site, the document should say so; as
written they simply vanish, and a reader cannot tell whether NC is a feature the site will
have at launch or a block nobody has finished.

Third, the reader cannot independently confirm the status of any of these blocks, because
the sibling docs still disagree: `docs/EFFECTS.md` opens its tag inventory with "Ни один тег
**реверба** пока не найден" and lists `0x44:0x08/0a/0b/0f` as "не расшифрованы", while
`src/reverb-hid.js` assigns all four to reverb fields. §5 of this document should name which
evidence it is relying on so the reader does not have to arbitrate.

Consequence for the decision: the document asks the reader to accept that protocol work is
essentially done and portable. Two unfinished blocks are missing from the list that is
supposed to enumerate the remainder, and for a third — the one whose absence from that list
is the strongest evidence it is done — the document suppresses the precondition under which
it works. The size of the "реверс почти закончен" claim cannot be checked from here.

Fix: make the table exhaustive (add noise reduction and 48V with their real status), and add
one line to §2A: reverb writes only apply when the type is not Bypass, so set type first.

### 6. Severity: Major
**Affected Scope:** §6 R1 (L151–155); §2A "- keepalive в фоне" (L53–55); §8 gate
(L205–208).

**Discrepancy Description & Rationale.** R1 calls the background-tab failure "UX-проблема,
а не блокер" and closes it with a prescribed fix: "Лечится: Web Worker с `setInterval` +
запрос «не спи» через `navigator.wakeLock` (тоже не всегда работает)". The project's own
`research/WEBHID.md` §3.2 says of that exact fix: "Chrome **душит таймеры в фоновых
вкладках** (throttling до 1 раза в минуту)… Web Worker — таймеры там **тоже душатся**,
но меньше". So the mitigation the document relies on is the one its own research already
calls insufficient, and the document does not say it was tested, does not name an
acceptance criterion, and does not explain what the user sees when the renewal silently
stops — the baseline is explicit that the failure is silent ("поток событий прекратится
без предупреждения").

This is load-bearing for the recommendation: the entire "просто зайти на сайт" value
proposition assumes the tab may sit in the background, and §8 gates only the volume read
(L205–208), not a 30-minute background run. A reader evaluating A takes R1 as closed.

Fix: state what was measured (or that nothing was), and add the background-idle case to
the §8 probe. If a foreground-only client is the real design, say so and drop the claim
that this is not a blocker.

### 7. Severity: Major
**Affected Scope:** §4 (L120–125), specifically "переносятся в браузер без изменений".

**Discrepancy Description & Rationale.** The document names nine modules as porting
unchanged — `protocol.js`, `mixer-tags.js`, `eq-hid.js`, `comp-hid.js`, `reverb-hid.js`,
`modes.js`, `tags.js`, `controls.js`, `settings.js` — and concludes "ядро протокола
переносится, обвязка — нет". At least one named module is not unchanged: `src/protocol.js`
exports `withReportId()`, which builds a Node `Buffer` (`Buffer.alloc`, `Buffer.from(...)
.copy(...)`, `src/protocol.js` L100–105). `Buffer` is a Node global and does not exist in
a browser. The browser path does not even need that wrapper (`sendReport(0, frame)` takes
the report id as an argument), so the function must be dropped or rewritten.

The claim shapes the reading of this section: a reader takes "без изменений" as "copy nine
files and the protocol works", which is exactly the effort estimate §8 depends on. The
list also omits modules that a browser port plainly needs — headphone EQ (`eq-hp.js`,
which is inside the claimed 85%), the mixer map (`eq-mixer.js`) and the CRC implementation
(`crc16.js`) — so a reader building from this list will find the gaps late.

Fix: "переносятся без изменений, кроме `withReportId()` в `protocol.js` — он Node-only и в
браузере не нужен", and complete the module list.

---

## Nits

### 8. Severity: Nit
**Affected Scope:** §5 table, row "sample rate и buffer size в HID" (L140).

Listed as open research ("если их там нет — только UIAutomation"), but the baselines treat
it as settled the other way: sample rate and buffer size are in neither HID nor IOCTL, only
UIAutomation (`STATUS.md` «Чего нет и почему», L162). The row is hedged, so the reader can
infer the answer, but it still advertises a research item the project considers closed —
one word ("не найдено, см. STATUS") would remove the ambiguity.

### 9. Severity: Nit
**Affected Scope:** §4 item 2 (L111–112); §7.2 (L180–182).

The state file is described as holding "состояние микшера и loopback", but the store also
holds ducking (`state-store.js` keeps `mixer`, `loopback` and `ducking` in one file), and
ducking behaves exactly like loopback — written to the device, never read back
(`STATUS.md` "Чего проверить нельзя": "Ducking и loopback пишутся, но обратно не читаются").
§4 therefore gives loopback a replacement store in variant A and leaves ducking, which is
named as covered in the 85% (L36), with no home at all. One clause is missing: ducking's
state also moves to IndexedDB.

### 10. Severity: Nit
**Affected Scope:** §2C (L87–89); §7.2 (L180–182).

Two project-specific references are used as shared knowledge. "как уже было с
`state-check.js` и `modes.js`" (L88) cites an incident that is not described — what
diverged, what broke, what the consequence was — so the warning "риск, что они разойдутся"
has no content for a reader who was not there; the reader is being asked to accept an
argument from a story they cannot see. "Профиль MCC" is only half-defined: L40 says
"профили MCC — это файлы на диске", which says where they live but not what they contain.
Without that, the proposed substitute at L181–182 ("сохранять матрицу микшера и loopback в
IndexedDB") cannot be judged — the document itself offers the caveat "но они не будут
совместимы с профилями MCC", and a reader has no way to estimate what breaks, since a
workspace also carries inputs, outputs, EQ and effects (as L49–50 of the sibling docs and
this document's own L117 hint at).

### 11. Severity: Nit
**Affected Scope:** §2B minus 2 (L74–77); §7 (L177–188).

"Chrome требует Private Network Access, и политика меняется" states the decisive risk to
variant B and then leaves it unresolved: no link, no statement of whether a public HTTPS
site can reach `http://127.0.0.1` today, and it is not added to §7 "Что не решено". Since
B's whole value is "любой браузер + 100%", a reader deciding between A and B cannot tell
whether B is currently buildable at all. Cite the current PNA/mixed-content rule, or list
it as an open question.
