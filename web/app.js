/**
 * КЛИЕНТ СТРАНИЦЫ (вынесен из index.html).
 *
 * ═══ ПОЧЕМУ ОТДЕЛЬНЫЙ ФАЙЛ ═══
 *
 * Раньше весь этот код был встроен в <script type="module">
 * внутри index.html. Это работало на dev-сервере, но на
 * продакшн-сервере CSP `script-src 'self'` блокирует инлайн-
 * скрипты, и страница не выполнялась вовсе.
 *
 * Вынос даёт ещё два плюса: файл кэшируется отдельно от HTML
 * и проверяется линтером (встроенный код ESLint не видит).
 */
import { M62TransportCore } from '../src/transport-core.js';
import { requestDevice, openWebHidDevice, isWebHidSupported } from '../src/adapter-webhid.js';
import { buildEqFrames, readChannelBands } from '../src/eq-hid.js';
import { buildCompFrames, readCompressor } from '../src/comp-hid.js';
import { buildReverbFrames, readReverb, REVERB_TYPES } from '../src/reverb-hid.js';
import { buildPhantomFrames } from '../src/phantom-hid.js';
import { formatGain } from '../src/gain-scales.js';
import {
  EQ_HP_BANDS,
  EQ_HP_FIELDS,
  EQ_HP_FIRST,
  EQ_HP_RIGHT_OFFSET,
  buildBandFrames as buildHpFrames,
  readBand as readHpBand,
} from '../src/eq-hp.js';
import { MIXER_BUSES, MIXER_SOURCES, buildMixerPacket } from '../src/mixer-tags.js';
import {
  clearMixerState,
  countKnown,
  diffMatrix,
  emptyMatrix,
  loadMixerState,
  saveMixerState,
  setCell,
} from './mixer-state.js';
import {
  getScene,
  listScenes,
  removeScene,
  saveScene,
  sceneLimitations,
} from './scenes.js';
import {
  LOOPBACK_RETURNS,
  MUTE_CONTROLS,
  SOURCE_ITEMS,
  buildLoopbackGainFrames,
  buildMuteFrames,
  buildSelectorFrames,
  lbStepToDb,
  readAllMutes,
} from '../src/mutes-loopback.js';

const $ = (id) => document.getElementById(id);
const logEl = $('log');
const log = (msg, kind = '') => {
  const s = document.createElement('span');
  s.className = kind;
  s.textContent = `[${new Date().toLocaleTimeString('ru-RU')}] ${msg}\n`;
  logEl.appendChild(s);
  logEl.scrollTop = logEl.scrollHeight;
};
const quiet = { info: () => {}, warn: (m) => log(m, 'warn'), error: (m) => log(String(m), 'err') };

let t = null;
let writeChain = Promise.resolve();

/** Очередь записи: кадры не должны перебивать друг друга. */
function queue(fn) {
  writeChain = writeChain.then(fn).catch((e) => log(`запись: ${e?.message ?? e}`, 'err'));
  return writeChain;
}

function setLast(txt) { $('dLast').textContent = txt; }

/** Отправить кадры и отметить в логе. */
async function send(frames, label) {
  if (!t) return;
  try {
    t.writeFrames(frames, { updateCache: true });
    setLast(label);
    log(`→ ${label}`, 'ok');
    setTimeout(render, 400);
  } catch (e) {
    log(`ошибка записи: ${e?.message ?? e}`, 'err');
  }
}

/** Запись EQ — с удержанием сессии. */
async function sendEq(frames, label) {
  if (!t) return;
  try {
    setLast(`${label} (коммит…)`);
    log(`→ ${label} (держим сессию 2.5 с)`, 'warn');
    await t.writeEqWithCommit(frames);
    await t.readViaDump();
    setLast(label);
    log(`✓ ${label}`, 'ok');
    render();
  } catch (e) {
    log(`ошибка EQ: ${e?.message ?? e}`, 'err');
  }
}

// ─── рендер ───
function render() {
  if (!t) return;
  const g = (tt, pp) => t.get(tt, pp);

  $('dTags').textContent = Object.keys(t.snapshot()).length;

  // Батарея: 0x11:0x18 — проценты (проверено на карте: 94).
  // Раньше считалось «счётчиком сессии».
  const battery = g(0x11, 0x18);
  if (battery !== null && battery >= 0 && battery <= 100) {
    $('dBattery').textContent = `${battery}%`;
  } else {
    $('dBattery').textContent = '—';
  }

  // Режим: карта отвечает на handshake кодом своего режима.
  // 1 Mobile, 2 Live, 3 Prof (замерено: Live=2 -> 92 адреса,
  // Prof=3 -> 203 адреса).
  const modeCode = g(0x11, 0x01);
  const MODE_NAMES = { 1: 'Mobile', 2: 'Live', 3: 'Prof' };
  $('dMode').textContent = MODE_NAMES[modeCode] ?? '—';
  $('dReads').textContent = String(t.stats.reads);
  $('dWrites').textContent = String(t.stats.writes);

  const hpJack = g(0x64, 0x06);
  $('oHpJack').textContent = hpJack === 1 ? 'подключены' : 'нет';
  $('safety').classList.toggle('show', hpJack === 1 && g(0x64, 0x04) !== 1);

  const hpMute = g(0x64, 0x04);
  const hpMuteBtn = $('oHpMute');
  hpMuteBtn.textContent = hpMute === 1 ? 'MUTE' : 'выкл';
  hpMuteBtn.classList.toggle('on', hpMute === 1);

  const hpVol = g(0x64, 0x03);
  if (hpVol !== null) { $('oHpVol').value = hpVol; $('oHpVolV').textContent = formatGain(hpVol, 'out9'); }

  $('oOtgJack').textContent = g(0x62, 0x06) === 1 ? 'подключён' : 'нет';
  const otgMute = g(0x62, 0x04);
  $('oOtgMute').textContent = otgMute === 1 ? 'MUTE' : 'выкл';
  $('oOtgMute').classList.toggle('on', otgMute === 1);

  // усиления
  //
  // ВАЖНО: сырое значение — это ШАГ шкалы, а не дБ. У каждого входа
  // своя кривая (данные из mainline-драйвера, см. src/gain-scales.js):
  //   IN1/IN2 — 0..88 дБ, шаг 1 дБ;
  //   AUX     — шаг 81 = 0 дБ;
  //   BT, OTG — шаг 99 = 0 дБ.
  // Раньше сюда выводилось сырое число как будто это дБ.
  const gains = [
    [0x21, 'gIn1', 'mic'], [0x22, 'gIn2', 'mic'],
    [0x23, 'gAux', 'out9'], [0x25, 'gBt', 'out0'], [0x27, 'gOtg', 'out0'],
  ];
  for (const [tt, id, curve] of gains) {
    const v = g(tt, 0x04);
    if (v === null) continue;
    $(id).value = v;
    $(`${id}V`).textContent = formatGain(v, curve);
  }

  // 48V
  for (const [tt, id] of [[0x21, 'p48v1'], [0x22, 'p48v2']]) {
    const v = g(tt, 0x03);
    const b = $(id);
    b.textContent = v === 1 ? '48V ВКЛ' : 'выкл';
    b.classList.toggle('on', v === 1);
  }

  // реверб
  const rv = readReverb(t.snapshot());
  if (rv && rv.type !== null && rv.type !== undefined) {
    $('rvType').value = String(rv.type);
  }
  for (const [k, id] of [['dryWet', 'rvWet'], ['room', 'rvRoom'], ['decay', 'rvDecay'], ['width', 'rvWidth']]) {
    if (rv && rv[k] !== null && rv[k] !== undefined) {
      $(id).value = rv[k];
      $(`${id}V`).textContent = rv[k];
    }
  }
  const bypass = rv && rv.type === 1;
  $('rvNote').textContent = bypass ? 'в Bypass параметры не применяются' : '';

  // компрессор
  const cp = readCompressor(t.snapshot());
  if (cp) {
    const sw = cp.switch;
    const b = $('cpSwitch');
    b.textContent = sw === 1 ? 'включён' : 'bypass';
    b.classList.toggle('on', sw === 1);
    const map = [['threshold', 'cpThr'], ['ratio', 'cpRatio'], ['attack', 'cpAtk'], ['release', 'cpRel'], ['mix', 'cpMix']];
    for (const [k, id] of map) {
      if (cp[k] !== null && cp[k] !== undefined) {
        $(id).value = cp[k];
        $(`${id}V`).textContent = cp[k];
      }
    }
  }

  // EQ — отдельной функцией (нужна и при смене входа)
  if (typeof renderEq === 'function') renderEq();
  if (typeof renderEqHp === 'function') renderEqHp();
  if (typeof renderMutes === 'function') renderMutes();
}

// ─── подключение ───
function enableControls(on) {
  document.querySelectorAll('input[type=range], select, .card button').forEach((el) => {
    if (el.id === 'btnConnect' || el.id === 'btnDisconnect') return;
    el.disabled = !on;
  });
  $('btnDump').disabled = !on;
}

async function connect() {
  if (!isWebHidSupported()) { log('WebHID не поддерживается. Chrome или Edge 89+.', 'err'); return; }
  try {
    $('status').textContent = 'выбор…';
    const device = await requestDevice();
    if (!device) { $('status').textContent = 'не подключено'; log('устройство не выбрано', 'warn'); return; }
    log(`выбрано: ${device.productName || 'M62'}`);

    const adapter = await openWebHidDevice(device);
    t = new M62TransportCore({ adapter, logger: quiet });
    t.on('change', () => render());
    t.on('error', (e) => log(`ошибка: ${e?.message ?? e}`, 'err'));

    await t.open();
    log('сессия открыта', 'ok');

    $('status').textContent = 'подключено';
    $('status').className = 'badge on';
    $('btnConnect').disabled = true;
    $('btnDisconnect').disabled = false;
    enableControls(true);

    setTimeout(render, 1200);
    setTimeout(render, 3500);
    setTimeout(() => {
      render();
      log(`адресов: ${Object.keys(t.snapshot()).length}`, 'ok');
      if (t.get(0x64, 0x06) === 1 && t.get(0x64, 0x04) !== 1) {
        log('⚠ наушники подключены и НЕ заглушены — нажмите «Заглушить»', 'warn');
      }
    }, 6500);
  } catch (err) {
    log(`не удалось: ${err?.message ?? err}`, 'err');
    $('status').textContent = 'ошибка';
    $('status').className = 'badge';
  }
}

function disconnect() {
  try { t?.close(); } catch { /* уже */ }
  t = null;
  $('status').textContent = 'не подключено';
  $('status').className = 'badge';
  $('btnConnect').disabled = false;
  $('btnDisconnect').disabled = true;
  enableControls(false);
  log('отключено');
}

$('btnConnect').addEventListener('click', connect);
$('btnDisconnect').addEventListener('click', disconnect);

$('btnDump').addEventListener('click', () => queue(async () => {
  log('запрашиваю дамп…');
  await t.readViaDump();
  render();
  log(`дамп получен, адресов: ${Object.keys(t.snapshot()).length}`, 'ok');
}));

// ─── обработчики управления ───

// HP volume
$('oHpVol').addEventListener('input', (e) => { $('oHpVolV').textContent = formatGain(Number(e.target.value), 'out9'); });
$('oHpVol').addEventListener('change', (e) => queue(() => {
  const v = Number(e.target.value);
  return send([{ target: 0x64, prop: 0x03, value: v }, { target: 0x63, prop: 0x03, value: v }], `HP громкость ${formatGain(v, 'out9')}`);
}));

// HP mute (обе цели пары!)
$('oHpMute').addEventListener('click', () => queue(() => {
  const cur = t.get(0x64, 0x04) === 1 ? 1 : 0;
  const v = cur === 1 ? 0 : 1;
  return send([{ target: 0x64, prop: 0x04, value: v }, { target: 0x63, prop: 0x04, value: v }], `HP MUTE ${v ? 'вкл' : 'выкл'}`);
}));
$('oHpMuteOn').addEventListener('click', () => queue(() =>
  send([{ target: 0x64, prop: 0x04, value: 1 }, { target: 0x63, prop: 0x04, value: 1 }], 'HP заглушён')));

// OTG mute
$('oOtgMute').addEventListener('click', () => queue(() => {
  const cur = t.get(0x62, 0x04) === 1 ? 1 : 0;
  const v = cur === 1 ? 0 : 1;
  return send([{ target: 0x62, prop: 0x04, value: v }, { target: 0x61, prop: 0x04, value: v }], `OTG MUTE ${v ? 'вкл' : 'выкл'}`);
}));

// усиления входов
//
// Ползунок двигает ШАГ, а подпись показывает дБ по правильной кривой.
// Раньше подпись показывала сырое число, то есть «81» вместо «0 dB».
const gainMap = [
  ['gIn1', 0x21, 'mic'], ['gIn2', 0x22, 'mic'],
  ['gAux', 0x23, 'out9'], ['gBt', 0x25, 'out0'], ['gOtg', 0x27, 'out0'],
];
for (const [id, tt, curve] of gainMap) {
  $(id).addEventListener('input', (e) => {
    $(`${id}V`).textContent = formatGain(Number(e.target.value), curve);
  });
  $(id).addEventListener('change', (e) => queue(() =>
    send(
      [{ target: tt, prop: 0x04, value: Number(e.target.value) }],
      `усиление 0x${tt.toString(16)} = ${formatGain(Number(e.target.value), curve)}`,
    )));
}

// 48V
for (const [id, ch] of [['p48v1', 'IN1'], ['p48v2', 'IN2']]) {
  $(id).addEventListener('click', () => {
    const tt = ch === 'IN1' ? 0x21 : 0x22;
    const cur = t.get(tt, 0x03) === 1 ? 1 : 0;
    const v = cur === 1 ? 0 : 1;
    if (v === 1) {
      const ok = confirm(`Подать 48 В на ${ch}?\n\nЭто фантомное питание для КОНДЕНСАТОРНОГО микрофона.\nНе включайте на линейном или инструментальном входе — можно повредить оборудование.`);
      if (!ok) return;
    }
    queue(() => send(buildPhantomFrames(ch, v === 1), `48V ${ch} ${v ? 'вкл' : 'выкл'}`));
  });
}

// реверб: тип
$('rvType').addEventListener('change', (e) => queue(async () => {
  const code = Number(e.target.value);
  await send(buildReverbFrames('type', code), `реверб ${REVERB_TYPES[code]}`);
}));

// реверб: параметры (только если не Bypass)
//
// ВАЖНО: width у модуля задаётся 0..1 (в HID уходит ×100).
// В интерфейсе удобнее 0..100, поэтому делим перед отправкой.
for (const [id, field, scale] of [['rvWet', 'dryWet', 1], ['rvRoom', 'room', 1], ['rvDecay', 'decay', 1], ['rvWidth', 'width', 100]]) {
  $(id).addEventListener('input', (e) => { $(`${id}V`).textContent = e.target.value; });
  $(id).addEventListener('change', (e) => queue(async () => {
    const rv = readReverb(t.snapshot());
    if (rv && rv.type === 1) {
      log('реверб в Bypass — параметры не применятся. Сначала выберите тип.', 'warn');
      return;
    }
    const raw = Number(e.target.value) / scale;
    try {
      await send(buildReverbFrames(field, raw), `реверб ${field} = ${e.target.value}`);
    } catch (err) {
      log(`реверб ${field}: ${err?.message ?? err}`, 'err');
    }
  }));
}

// компрессор
$('cpSwitch').addEventListener('click', () => queue(() => {
  const cur = t.get(0x46, 0x01) === 1 ? 1 : 0;
  const v = cur === 1 ? 0 : 1;
  return send(buildCompFrames('switch', v), `компрессор ${v ? 'вкл' : 'bypass'}`);
}));

for (const [id, field] of [['cpThr', 'threshold'], ['cpRatio', 'ratio'], ['cpAtk', 'attack'], ['cpRel', 'release'], ['cpMix', 'mix']]) {
  $(id).addEventListener('input', (e) => { $(`${id}V`).textContent = e.target.value; });
  $(id).addEventListener('change', (e) => queue(async () => {
    try {
      const frames = buildCompFrames(field, Number(e.target.value));
      await send(frames, `компрессор ${field} = ${e.target.value}`);
    } catch (err) {
      log(`компрессор ${field}: ${err?.message ?? err}`, 'err');
    }
  }));
}

// ═══════════════════════════════════════════════════════════════════
// EQ ВХОДОВ: IN1 и IN2, 4 полосы × (включение, тип, gain, частота, Q)
// ═══════════════════════════════════════════════════════════════════
//
// АДРЕСА (проверено buildEqFrames):
//   IN1: полосы 1,2 -> 0x91   полосы 3,4 -> 0x92
//   IN2: полосы 1,2 -> 0x93   полосы 3,4 -> 0x94
//
// СВОЙСТВА внутри блока:
//   полоса нечётная (1,3): enable 0x01, type 0x02, gain 0x03, freq 0x04, q 0x05
//   полоса чётная   (2,4): enable 0x06, type 0x07, gain 0x08, freq 0x09, q 0x0a
//
// ВАЖНО: Q уходит как Q×10000 (1.5 -> 15000). Это делает buildEqFrames.
// Тип: 1 peaking, 2 lowpass, 3 highpass, 4 lowshelf, 5 highshelf.

const EQ_TYPES = [
  [1, 'peaking'],
  [2, 'lowpass'],
  [3, 'highpass'],
  [4, 'lowshelf'],
  [5, 'highshelf'],
];

/** Блок и свойство для полосы данного входа. */
function eqAddress(input, band, field) {
  const base = input === 'IN2' ? 0x93 : 0x91;
  const target = band <= 2 ? base : base + 1;
  const odd = band % 2 === 1;
  const prop = {
    enable: odd ? 0x01 : 0x06,
    type: odd ? 0x02 : 0x07,
    gain: odd ? 0x03 : 0x08,
    freq: odd ? 0x04 : 0x09,
    q: odd ? 0x05 : 0x0a,
  }[field];
  return { target, prop };
}

/** Построить все контролы полос один раз. */
function buildEqControls() {
  const host = $('eqBands');
  host.innerHTML = '';
  for (let band = 1; band <= 4; band += 1) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:grid;grid-template-columns:60px 64px 96px 1fr 1fr 1fr;gap:8px;align-items:center;padding:4px 0;border-bottom:1px solid rgba(255,255,255,.04)';
    wrap.innerHTML = `
      <span style="color:var(--muted);font-size:13px">полоса ${band}</span>
      <button id="eq${band}en" class="danger" disabled>выкл</button>
      <select id="eq${band}type" disabled>
        ${EQ_TYPES.map(([c, n]) => `<option value="${c}">${n}</option>`).join('')}
      </select>
      <label style="color:var(--muted);font-size:12px">gain
        <input type="range" id="eq${band}gain" min="-12" max="12" value="0" disabled>
        <span id="eq${band}gv" style="font-variant-numeric:tabular-nums">0</span>
      </label>
      <label style="color:var(--muted);font-size:12px">частота
        <input type="range" id="eq${band}freq" min="0" max="100" value="50" disabled>
        <span id="eq${band}fv" style="font-variant-numeric:tabular-nums">—</span>
      </label>
      <label style="color:var(--muted);font-size:12px">Q
        <input type="range" id="eq${band}q" min="0" max="100" value="50" disabled>
        <span id="eq${band}qv" style="font-variant-numeric:tabular-nums">—</span>
      </label>
    `;
    host.appendChild(wrap);
  }
}

/**
 * Частота: слайдер 0..100 -> 20..20000 Гц логарифмически.
 * Логарифм нужен потому, что линейный слайдер бесполезен:
 * весь диапазон 20-20000 в линейном масштабе сжат в начало.
 */
const freqFromSlider = (v) => Math.round(20 * (1000 ** (v / 100)));
const sliderFromFreq = (f) => Math.round(100 * Math.log(f / 20) / Math.log(1000));

/** Q: слайдер 0..100 -> 0.05..20 логарифмически. */
const qFromSlider = (v) => Number((0.05 * (400 ** (v / 100))).toFixed(2));
const sliderFromQ = (q) => Math.round(100 * Math.log(q / 0.05) / Math.log(400));

/** Текущий выбранный вход EQ. */
const eqInput = () => $('eqInput').value || 'IN1';

function wireEqControls() {
  for (let band = 1; band <= 4; band += 1) {
    const enBtn = $(`eq${band}en`);
    const typeEl = $(`eq${band}type`);
    const gainEl = $(`eq${band}gain`);
    const freqEl = $(`eq${band}freq`);
    const qEl = $(`eq${band}q`);

    const { target, prop } = eqAddress('IN1', band, 'enable');
    void target;
    void prop;

    // включение полосы
    enBtn.addEventListener('click', () => queue(async () => {
      const input = eqInput();
      const a = eqAddress(input, band, 'enable');
      const cur = t.get(a.target, a.prop) === 1 ? 1 : 0;
      await sendEq(
        [{ target: a.target, prop: a.prop, value: cur === 1 ? 0 : 1 }],
        `EQ ${input} полоса ${band} ${cur === 1 ? 'выкл' : 'вкл'}`,
      );
    }));

    // тип фильтра
    typeEl.addEventListener('change', (e) => queue(async () => {
      const input = eqInput();
      const frames = buildEqFrames(input, band, 'type', Number(e.target.value));
      await sendEq(frames, `EQ ${input} полоса ${band} тип ${e.target.options[e.target.selectedIndex].text}`);
    }));

    // gain
    gainEl.addEventListener('input', (e) => {
      $(`eq${band}gv`).textContent = `${e.target.value} дБ`;
    });
    gainEl.addEventListener('change', (e) => queue(async () => {
      const input = eqInput();
      const frames = buildEqFrames(input, band, 'gain', Number(e.target.value));
      await sendEq(frames, `EQ ${input} полоса ${band} gain ${e.target.value}`);
    }));

    // частота
    freqEl.addEventListener('input', (e) => {
      $(`eq${band}fv`).textContent = `${freqFromSlider(Number(e.target.value))} Гц`;
    });
    freqEl.addEventListener('change', (e) => queue(async () => {
      const input = eqInput();
      const hz = freqFromSlider(Number(e.target.value));
      const frames = buildEqFrames(input, band, 'freq', hz);
      await sendEq(frames, `EQ ${input} полоса ${band} ${hz} Гц`);
    }));

    // Q
    qEl.addEventListener('input', (e) => {
      $(`eq${band}qv`).textContent = String(qFromSlider(Number(e.target.value)));
    });
    qEl.addEventListener('change', (e) => queue(async () => {
      const input = eqInput();
      const q = qFromSlider(Number(e.target.value));
      const frames = buildEqFrames(input, band, 'q', q);
      await sendEq(frames, `EQ ${input} полоса ${band} Q=${q}`);
    }));
  }

  // смена входа — перерисовать значения
  $('eqInput').addEventListener('change', () => {
    log(`EQ: показываю ${eqInput()}`);
    render();
  });
}

/** Обновить контролы EQ из кеша для выбранного входа. */
function renderEq() {
  const input = eqInput();
  const bands = readChannelBands(t.snapshot(), input);
  for (let band = 1; band <= 4; band += 1) {
    const b = bands.find((x) => Number(x.band) === band);
    if (!b) continue;

    const en = $(`eq${band}en`);
    if (en) {
      en.textContent = b.enable === 1 ? 'вкл' : 'выкл';
      en.classList.toggle('on', b.enable === 1);
    }
    const typeEl = $(`eq${band}type`);
    if (typeEl && b.type) typeEl.value = String(b.type);

    if (b.gain !== null && b.gain !== undefined) {
      $(`eq${band}gain`).value = b.gain;
      $(`eq${band}gv`).textContent = `${b.gain} дБ`;
    }
    if (b.freq) {
      $(`eq${band}freq`).value = sliderFromFreq(b.freq);
      $(`eq${band}fv`).textContent = `${b.freq} Гц`;
    }
    if (b.q) {
      $(`eq${band}q`).value = sliderFromQ(b.q);
      $(`eq${band}qv`).textContent = String(b.q);
    }
  }

  // предупреждение: в Live IN2-блоки могут отсутствовать
  const cnt = Object.keys(t.snapshot()).filter((k) => /^(147|148):/.test(k)).length;
  $('eqNote').textContent = input === 'IN2' && cnt === 0
    ? 'блоки IN2 не пришли — возможно, вход не активен'
    : '';
}

buildEqControls();
wireEqControls();

// ═══════════════════════════════════════════════════════════════════
// EQ НАУШНИКОВ: 10 полос × 2 канала (L/R) — только режим Prof
// ═══════════════════════════════════════════════════════════════════
//
// АДРЕСА (docs/EQ-HP.md, проверено скриншотом окна MCC):
//   0xa1 = полоса 1 ... 0xaa = полоса 10
//   свойства 0x01..0x05 = ЛЕВЫЙ канал
//   свойства 0x06..0x0a = ПРАВЫЙ канал (смещение +5)
//
// ПОЧЕМУ БЛОК СКРЫТ, ПОКА НЕТ 0xa1..0xaa:
//   в Live и Mobile этих блоков нет вовсе. Показывать контролы,
//   которые ничего не делают, — хуже, чем не показывать ничего.
//   Наличие этих блоков И ЕСТЬ признак Prof (см. modes.js).

/** Есть ли в снимке блоки EQ наушников. */
function hpBlocksPresent() {
  if (!t) return false;
  return Object.keys(t.snapshot()).some((k) => {
    const [a, b] = k.split(':');
    // ключи transport даёт в десятичном виде ("161:3"), дампы — в hex
    const tt = /[a-f]/i.test(a) ? parseInt(a, 16) : Number(a);
    void b;
    return Number.isFinite(tt) && tt >= 0xa1 && tt <= 0xaa;
  });
}

/** Заполнить список полос один раз. */
function buildHpControls() {
  const sel = $('eqHpBand');
  sel.innerHTML = '';
  for (let band = 1; band <= EQ_HP_BANDS; band += 1) {
    const o = document.createElement('option');
    o.value = String(band);
    o.textContent = String(band);
    sel.appendChild(o);
  }
}

const hpChannel = () => $('eqHpChannel').value || 'l';
const hpBand = () => Number($('eqHpBand').value) || 1;

/** Текущие значения выбранной полосы/канала из кеша. */
function hpCurrent() {
  if (!t) return null;
  const b = readHpBand(t.snapshot(), hpBand());
  if (!b) return null;
  return hpChannel() === 'r' ? b.r : b.l;
}

function renderEqHp() {
  const present = hpBlocksPresent();
  const card = $('eqHpCard');
  const note = $('eqHpNote');
  const fields = $('eqHpFields');

  if (!present) {
    card.style.opacity = '0.6';
    note.textContent = 'блоки EQ наушников не пришли — нужен режим Prof';
    fields.style.display = 'none';
    return;
  }

  card.style.opacity = '1';
  note.textContent = 'режим Prof — 10 полос × 2 канала';
  fields.style.display = '';

  const cur = hpCurrent();
  if (!cur) { $('eqHpState').textContent = 'нет значения'; return; }

  $('eqHpEn').textContent = cur.enable === 1 ? 'вкл' : 'выкл';
  $('eqHpEn').classList.toggle('on', cur.enable === 1);
  if (cur.type) $('eqHpType').value = String(cur.type);

  if (cur.gain !== null && cur.gain !== undefined) {
    $('eqHpGain').value = cur.gain;
    $('eqHpGainV').textContent = `${cur.gain} дБ`;
  }
  if (cur.freq) {
    $('eqHpFreq').value = sliderFromFreq(cur.freq);
    $('eqHpFreqV').textContent = `${cur.freq} Гц`;
  }
  if (cur.q) {
    $('eqHpQ').value = sliderFromQ(cur.q);
    $('eqHpQV').textContent = String(cur.q);
  }
  $('eqHpState').textContent = `полоса ${hpBand()} ${hpChannel() === 'r' ? 'R' : 'L'}`;
}

function wireEqHpControls() {
  buildHpControls();

  // Адрес поля: блок = 0xa1 + полоса - 1, свойство = поле + смещение канала.
  const hpAddr = (band, field) => {
    const target = EQ_HP_FIRST + band - 1;
    const base = EQ_HP_FIELDS[field];
    const offset = hpChannel() === 'r' ? EQ_HP_RIGHT_OFFSET : 0;
    return { target, prop: base + offset };
  };

  $('eqHpEn').addEventListener('click', () => queue(async () => {
    const a = hpAddr(hpBand(), 'enable');
    const cur = t.get(a.target, a.prop) === 1 ? 1 : 0;
    await sendEq(
      [{ target: a.target, prop: a.prop, value: cur === 1 ? 0 : 1 }],
      `EQ HP полоса ${hpBand()} ${hpChannel() === 'r' ? 'R' : 'L'} ${cur === 1 ? 'выкл' : 'вкл'}`,
    );
  }));

  $('eqHpType').addEventListener('change', (e) => queue(async () => {
    const band = hpBand();
    const frames = buildHpFrames(band, {
      [hpChannel()]: { type: Number(e.target.value) },
    });
    await sendEq(frames, `EQ HP полоса ${band} тип ${e.target.options[e.target.selectedIndex].text}`);
  }));

  $('eqHpGain').addEventListener('input', (e) => {
    $('eqHpGainV').textContent = `${e.target.value} дБ`;
  });
  $('eqHpGain').addEventListener('change', (e) => queue(async () => {
    const band = hpBand();
    const frames = buildHpFrames(band, { [hpChannel()]: { gain: Number(e.target.value) } });
    await sendEq(frames, `EQ HP полоса ${band} gain ${e.target.value}`);
  }));

  $('eqHpFreq').addEventListener('input', (e) => {
    $('eqHpFreqV').textContent = `${freqFromSlider(Number(e.target.value))} Гц`;
  });
  $('eqHpFreq').addEventListener('change', (e) => queue(async () => {
    const band = hpBand();
    const hz = freqFromSlider(Number(e.target.value));
    const frames = buildHpFrames(band, { [hpChannel()]: { freq: hz } });
    await sendEq(frames, `EQ HP полоса ${band} ${hz} Гц`);
  }));

  $('eqHpQ').addEventListener('input', (e) => {
    $('eqHpQV').textContent = String(qFromSlider(Number(e.target.value)));
  });
  $('eqHpQ').addEventListener('change', (e) => queue(async () => {
    const band = hpBand();
    const q = qFromSlider(Number(e.target.value));
    const frames = buildHpFrames(band, { [hpChannel()]: { q } });
    await sendEq(frames, `EQ HP полоса ${band} Q=${q}`);
  }));

  for (const id of ['eqHpChannel', 'eqHpBand']) {
    $(id).addEventListener('change', () => { renderEqHp(); });
  }
}

buildHpControls();
wireEqHpControls();

// ═══════════════════════════════════════════════════════════════════
// МИКШЕР: 5 шин × 11 источников — НАША модель (карта не читается)
// ═══════════════════════════════════════════════════════════════════
//
// ═══ ПОЧЕМУ МОДЕЛЬ, А НЕ ЧТЕНИЕ ═══
//
// Проверено на 11 захватах: кросспоинты 0x31..0x3c:0x01..0x14
// записаны 1600 раз и НИ РАЗУ не пришли в IN. Карта принимает
// микшер и не отдаёт его назад. Прочитать невозможно.
//
// Сам MCC устроен так же — он держит микшер в workspace-INI.
//
// ═══ КАК ПИШЕМ ═══
//
// Только пакетом внутри брекета 0x11:0x20 (writeBulk). Одиночные
// кадры карта игнорирует — проверено.
//
// ═══ ЧЕСТНОСТЬ ═══
//
// После записи мы НЕ знаем, применилась ли она. В тишине метры не
// приходят вовсе, поэтому подтвердить нечем. Пишем 'unverified' и
// не делаем вид, что знаем результат.

/** Текущая матрица (наша модель). */
let mixerMatrix = null;
/** Матрица до последнего изменения — для diff при записи. */
let mixerBefore = null;

/** Текущая шина. */
const mixerBus = () => $('mixerBus').value || 'a';

/** Загрузить модель из localStorage или начать с пустой. */
function loadMixer() {
  const saved = loadMixerState();
  mixerMatrix = saved?.matrix ?? emptyMatrix(MIXER_BUSES, MIXER_SOURCES);
  mixerBefore = JSON.parse(JSON.stringify(mixerMatrix));
  return saved;
}

/** Заполнить список шин (один раз). */
function buildMixerControls() {
  const sel = $('mixerBus');
  sel.innerHTML = '';
  for (const bus of Object.keys(MIXER_BUSES)) {
    const o = document.createElement('option');
    o.value = bus;
    o.textContent = bus.toUpperCase();
    sel.appendChild(o);
  }
}

/** Построить строки источников для текущей шины. */
function buildMixerRows() {
  const host = $('mixerRows');
  const bus = mixerBus();
  host.innerHTML = '';

  for (const [key, info] of Object.entries(MIXER_SOURCES)) {
    const cell = mixerMatrix?.[bus]?.[key] ?? { l: null, r: null };
    const row = document.createElement('div');
    row.className = 'ctl';
    row.style.cssText = 'gap:8px';

    // Моно-источники (IN1/IN2) имеют один канал — второй не показываем.
    const showR = info.stereo;

    const lVal = cell.l === null ? '—' : `${cell.l} дБ`;
    const rVal = cell.r === null ? '—' : `${cell.r} дБ`;

    row.innerHTML = `
      <label style="min-width:104px">${info.name}</label>
      <input type="range" id="mx_${key}_l" min="-60" max="12" step="1"
             value="${cell.l === null ? -60 : cell.l}" disabled>
      <span class="val" id="mx_${key}_l_v">${lVal}</span>
      ${showR ? `<input type="range" id="mx_${key}_r" min="-60" max="12" step="1"
             value="${cell.r === null ? -60 : cell.r}" disabled>
      <span class="val" id="mx_${key}_r_v">${rVal}</span>` : '<span class="val" style="min-width:52px">моно</span><span style="min-width:52px"></span>'}
    `;
    host.appendChild(row);
  }

  wireMixerRows();
}

/** Навесить обработчики на строки. */
function wireMixerRows() {
  const bus = mixerBus();
  for (const key of Object.keys(MIXER_SOURCES)) {
    for (const ch of ['l', 'r']) {
      const el = $(`mx_${key}_${ch}`);
      if (!el) continue;

      el.addEventListener('input', () => {
        const v = Number(el.value);
        $(`mx_${key}_${ch}_v`).textContent = v <= -60 ? '−∞' : `${v} дБ`;
      });

      el.addEventListener('change', () => queue(async () => {
        const v = Number(el.value);
        const lvl = v <= -60 ? null : v;
        mixerMatrix = setCell(mixerMatrix, bus, key, { [ch]: lvl });
        saveMixerState(mixerMatrix);
        await writeMixerDiff();
      }));
    }
  }
}

/**
 * Записать изменения в карту.
 *
 * Отправляем ТОЛЬКО изменившиеся ячейки — не всю матрицу. Полная
 * матрица это 200 кадров; слать её на каждое движение ползунка
 * расточительно и создаёт лишний трафик по HID.
 */
async function writeMixerDiff() {
  if (!t) return;
  const changed = diffMatrix(mixerBefore, mixerMatrix);
  if (!changed.length) return;

  // Собираем состояние в формате buildMixerPacket.
  // Он ждёт { busName: { sourceName: db } } и строит все 200 кадров,
  // поэтому передаём полную матрицу — но с нашими значениями.
  const flat = {};
  for (const bus of Object.keys(mixerMatrix)) {
    flat[bus] = {};
    for (const [src, cell] of Object.entries(mixerMatrix[bus])) {
      // Для моно берём l (или r, если l пуст).
      const db = cell.l !== null ? cell.l : cell.r;
      // null = mute -> -90 дБ (ниже любого реального значения).
      flat[bus][src] = db === null ? -90 : db;
    }
  }

  try {
    setLast(`микшер: ${changed.length} ячеек`);
    log(`→ микшер: ${changed.length} изменений (пакетом)`, 'warn');
    const frames = buildMixerPacket(flat);
    t.writeBulk(frames);
    mixerBefore = JSON.parse(JSON.stringify(mixerMatrix));
    setLast('микшер записан (не подтверждён)');
    log('✓ микшер отправлен — подтвердить нельзя, карта не отдаёт его назад', 'warn');
    renderMixer();
  } catch (e) {
    log(`ошибка микшера: ${e?.message ?? e}`, 'err');
  }
}

/** Обновить счётчик известных ячеек. */
function renderMixer() {
  if (!mixerMatrix) return;
  const { known, total } = countKnown(mixerMatrix);
  $('mixerKnown').textContent = `задано ${known} из ${total}`;
}

buildMixerControls();
loadMixer();
buildMixerRows();
renderMixer();

$('mixerBus').addEventListener('change', () => {
  buildMixerRows();
  renderMixer();
});

$('mixerForget').addEventListener('click', () => {
  clearMixerState();
  mixerMatrix = emptyMatrix(MIXER_BUSES, MIXER_SOURCES);
  mixerBefore = JSON.parse(JSON.stringify(mixerMatrix));
  buildMixerRows();
  renderMixer();
  log('сохранённый микшер забыт — значения сброшены в тишину', 'warn');
});

$('mixerReadCard').addEventListener('click', () => {
  log('карта не отдаёт микшер: проверено 11 захватов, 1600 записей, 0 чтений', 'err');
  $('mixerNote').textContent =
    'Прочитать микшер с карты невозможно — это свойство протокола, а не недоработка.';
});

// ═══════════════════════════════════════════════════════════════════
// СЦЕНЫ: сохранить / загрузить / удалить
// ═══════════════════════════════════════════════════════════════════
//
// ═══ ЧТО СОХРАНЯЕМ ═══
//
//   params — все адреса из снимка, которые карта реально отдала.
//            Это проверяемое состояние: при загрузке пишем и можем
//            перечитать.
//
//   model  — матрица микшера (наша). Карта её не отдаёт, поэтому
//            восстановить «как было на карте» нельзя — только как
//            было в нашей модели.
//
// ═══ ЧЕГО НЕ СОХРАНЯЕМ ═══
//
// Метры (0x21:0x01, 0x31..0x34:0x15, 0x39:*) — это живой сигнал,
// а не настройка. Сохранять их бессмысленно: они меняются каждую
// секунду. Поэтому фильтруем.

/** Адреса, которые НЕ настройки, а живые показания. */
const METER_LIKE = new Set([
  '0x21:0x01',
  '0x31:0x15', '0x32:0x15', '0x33:0x15', '0x34:0x15',
  '0x35:0x15', '0x36:0x15',
  '0x39:0x01', '0x39:0x02',
  '0x44:0x0d', '0x44:0x0e',
  '0x46:0x0c', '0x46:0x0d',
  '0x9b:0x0b',
  '0x61:0x01', '0x62:0x01', '0x63:0x01', '0x64:0x01',
]);

/** Ключ снимка ("51:21") -> "0x33:0x15". */
function snapKeyToHex(k) {
  const [a, b] = String(k).split(':').map(Number);
  return `0x${a.toString(16).padStart(2, '0')}:0x${b.toString(16).padStart(2, '0')}`;
}

/** Собрать params: только читаемые настройки, без метров. */
function collectParams() {
  if (!t) return {};
  const out = {};
  for (const [k, v] of Object.entries(t.snapshot())) {
    const hex = snapKeyToHex(k);
    if (METER_LIKE.has(hex)) continue;
    out[hex] = v;
  }
  return out;
}

/** Обновить список сцен. */
function renderSceneList() {
  const sel = $('sceneList');
  const scenes = listScenes();
  sel.innerHTML = '';

  if (!scenes.length) {
    const o = document.createElement('option');
    o.value = '';
    o.textContent = '— нет сохранённых —';
    sel.appendChild(o);
    return;
  }

  for (const s of scenes) {
    const o = document.createElement('option');
    o.value = s.name;
    o.textContent = `${s.name} (${s.paramCount} парам.)`;
    sel.appendChild(o);
  }
}

$('sceneSave').addEventListener('click', () => {
  const name = $('sceneName').value.trim();
  if (!name) { log('введите имя сцены', 'err'); return; }

  const params = collectParams();
  const paramCount = Object.keys(params).length;
  const r = saveScene(name, { params, model: mixerMatrix });

  if (!r.ok) { log(`не сохранилось: ${r.error}`, 'err'); return; }

  log(`✓ сцена «${name}»: ${paramCount} параметров + модель микшера`, 'ok');
  $('sceneName').value = '';
  renderSceneList();
  $('sceneList').value = name;
});

$('sceneLoad').addEventListener('click', () => queue(async () => {
  const name = $('sceneList').value;
  if (!name) { log('нет сцены для загрузки', 'err'); return; }

  const scene = getScene(name);
  if (!scene) { log(`сцена «${name}» не найдена`, 'err'); return; }

  if (!t) { log('сначала подключите карту', 'err'); return; }

  // ─── 1. читаемые параметры ───
  const frames = [];
  for (const [hex, value] of Object.entries(scene.params ?? {})) {
    const m = hex.match(/^0x([0-9a-f]{2}):0x([0-9a-f]{2})$/i);
    if (!m) continue;
    frames.push({
      target: parseInt(m[1], 16),
      prop: parseInt(m[2], 16),
      value,
    });
  }

  if (frames.length) {
    t.writeFrames(frames, { updateCache: true });
    log(`→ сцена «${name}»: ${frames.length} параметров записано`, 'ok');
    setTimeout(render, 500);
  }

  // ─── 2. модель микшера ───
  if (scene.model) {
    mixerMatrix = scene.model;
    mixerBefore = JSON.parse(JSON.stringify(mixerMatrix));
    saveMixerState(mixerMatrix);
    buildMixerRows();
    renderMixer();
    log('микшер восстановлен из модели — на карте это не проверено', 'warn');
  }

  // ─── 3. честно сказать, что не восстановится ───
  const limits = sceneLimitations(scene);
  $('sceneNote').textContent = limits.length
    ? `Восстановлено. НЕ восстановится: ${limits.join(', ')}.`
    : 'Восстановлено.';
}));

$('sceneDelete').addEventListener('click', () => {
  const name = $('sceneList').value;
  if (!name) return;
  const r = removeScene(name);
  if (!r.ok) { log(`не удалилось: ${r.error}`, 'err'); return; }
  log(`сцена «${name}» удалена`, 'warn');
  renderSceneList();
  $('sceneNote').textContent = 'Сцена удалена.';
});

renderSceneList();

// ═══════════════════════════════════════════════════════════════════
// MUTES: кнопки «звук идёт» (инверсия карты)
// ═══════════════════════════════════════════════════════════════════
//
// ВАЖНО: карта принимает 1 = ЗАГЛУШЕНО. Кнопка показывает «звук идёт»,
// поэтому на провод уходит ИНВЕРСИЯ (buildMuteFrames это делает).
//
// Читается только mute выходов (0x64:0x04, 0x62:0x04 — приходят в
// announce). Mute входов карта не отдаёт, поэтому для них состояние
// берём из нашей модели.

/** Состояние mute входов (наша модель), id -> звук идёт. */
const inputMuteModel = {};

function buildMuteRows() {
  const host = $('muteRows');
  host.innerHTML = '';
  for (const c of MUTE_CONTROLS) {
    const row = document.createElement('div');
    row.className = 'ctl';
    row.innerHTML = `
      <label style="min-width:104px">${c.name}</label>
      <button id="mt_${c.id}" class="danger" disabled>—</button>
    `;
    host.appendChild(row);
  }
  wireMuteRows();
}

function wireMuteRows() {
  for (const c of MUTE_CONTROLS) {
    const btn = $(`mt_${c.id}`);
    if (!btn) continue;
    btn.addEventListener('click', () => queue(async () => {
      if (!t) return;
      const known = readAllMutes(t.snapshot())[c.id];
      const cur = known !== null && known !== undefined
        ? known
        : (inputMuteModel[c.id] ?? true);
      const next = !cur;

      t.writeFrames(buildMuteFrames(c, next), { updateCache: true });
      inputMuteModel[c.id] = next;

      log(`→ ${c.name}: ${next ? 'звук идёт' : 'заглушено'}`, next ? 'ok' : 'warn');
      setTimeout(renderMutes, 300);
    }));
  }
}

function renderMutes() {
  if (!t) return;
  const mutes = readAllMutes(t.snapshot());
  for (const c of MUTE_CONTROLS) {
    const btn = $(`mt_${c.id}`);
    if (!btn) continue;
    const known = mutes[c.id];
    const on = known !== null && known !== undefined
      ? known
      : (inputMuteModel[c.id] ?? null);

    if (on === null) {
      btn.textContent = '—';
      btn.classList.remove('on');
    } else {
      btn.textContent = on ? 'звук идёт' : 'заглушено';
      btn.classList.toggle('on', on);
    }
  }
}

buildMuteRows();

// ═══════════════════════════════════════════════════════════════════
// LOOPBACK: гейн + источник (наша модель, карта не отдаёт)
// ═══════════════════════════════════════════════════════════════════

/** Наша модель loopback: id -> { step, source }. */
const loopbackModel = {};

function buildLoopbackRows() {
  const host = $('loopbackRows');
  host.innerHTML = '';
  for (const r of LOOPBACK_RETURNS) {
    const row = document.createElement('div');
    row.className = 'ctl';
    row.style.cssText = 'gap:8px;flex-wrap:wrap';
    row.innerHTML = `
      <label style="min-width:104px">${r.name}</label>
      <input type="range" id="lb_${r.id}_gain" min="0" max="102" step="1" value="90" disabled>
      <span class="val" id="lb_${r.id}_gain_v">0 dB</span>
      <select id="lb_${r.id}_src" disabled>
        ${SOURCE_ITEMS.map((s) => `<option value="${s.value}">${s.label}</option>`).join('')}
      </select>
    `;
    host.appendChild(row);
    loopbackModel[r.id] = { step: 90, source: 12 };

    const gainEl = $(`lb_${r.id}_gain`);
    gainEl.addEventListener('input', (e) => {
      const db = lbStepToDb(Number(e.target.value));
      $(`lb_${r.id}_gain_v`).textContent = db === null ? 'MUTE' : `${db} dB`;
    });
    gainEl.addEventListener('change', (e) => queue(async () => {
      if (!t) return;
      const step = Number(e.target.value);
      loopbackModel[r.id].step = step;
      t.writeFrames(buildLoopbackGainFrames(r, step), { updateCache: false });
      const db = lbStepToDb(step);
      log(`→ ${r.name}: гейн ${db === null ? 'MUTE' : `${db} dB`} (не подтверждается)`, 'warn');
    }));

    const srcEl = $(`lb_${r.id}_src`);
    srcEl.addEventListener('change', (e) => queue(async () => {
      if (!t) return;
      const value = Number(e.target.value);
      loopbackModel[r.id].source = value;
      t.writeFrames(
        buildSelectorFrames({ target: r.selTarget, prop: 0x02 }, value),
        { updateCache: false },
      );
      log(`→ ${r.name}: источник ${srcEl.options[srcEl.selectedIndex].text}`, 'warn');
    }));
  }
}

buildLoopbackRows();

// ─── старт ───
if (!isWebHidSupported()) {
  $('btnConnect').disabled = true;
  log('этот браузер не поддерживает WebHID — откройте в Chrome или Edge', 'err');
} else {
  log('готово. Нажмите «Подключить» и выберите M62');
}

