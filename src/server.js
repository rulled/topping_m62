/**
 * HTTP + WebSocket сервер.
 *
 * Бекенд отдаёт:
 *   GET  /api/device          — состояние устройства и контролов
 *   GET  /api/controls        — описание контролов
 *   POST /api/volume          — установить громкость
 *   POST /api/selector        — установить селектор
 *   GET  /api/health          — статистика транспорта
 *   WS   /ws                  — поток событий
 *
 * Фронт подключается к WS и получает:
 *   {type:"hello",   ...}  описание контролов при подключении
 *   {type:"state",   ...}  снимок состояния
 *   {type:"event",   ...}  изменение параметра
 *   {type:"error",   ...}  проблема
 */

import http from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { WebSocketServer } from 'ws';

import { ControlService } from './controls-service.js';
import { describeEqMixer } from './eq-mixer.js';
import { SettingsService } from './settings-service.js';
import {
  applySnapshot,
  captureSnapshot,
  deleteSnapshot,
  diffSnapshots,
  listSnapshots,
  readSnapshot,
} from './snapshots.js';
import { classifyTag, COMP_METER_ROLES, describeTags, gainReductionDb, meterToDb, meterUnits, METER_SCALE } from './tags.js';
import { M62Transport } from './transport.js';
import { describeMixer, MIXER_SOURCES, MIXER_BUSES, SOURCE_CODES } from './mixer-tags.js';
import { buildBandFrames, describeEqHp, EQ_HP_BANDS, readAllBands } from './eq-hp.js';
import { clickByName, describeUiControls } from './ui-control.js';
import { AUDIO_OPTIONS as AUDIO_OPTIONS_FOR_API, readAllAudioParams, setAudioParam } from './audio-params.js';
import { bandEnableState, describeEq, dialIndexMap, EQ_LAYOUT, FILE_SETTLE_MS, isEqWindowOpen, nudgeEqParam, openEqWindow, pressDial, readEqSwitch, readEqTypes, setEqParamTo, setEqSwitch } from './eq-control.js';
import * as comp from './comp-control.js';
import {
  buildEqFrames,
  describeEqHid,
  DEVICE_TYPE_CODE,
  eqTagAddress,
  EQ_LIMITS as EQ_HID_LIMITS,
  readChannelBands,
  TYPE_BY_DEVICE_CODE,
  validateEqValue,
} from './eq-hid.js';
import {
  buildCompFrames,
  describeCompHid,
  readCompressor as readCompressorHid,
  validateCompValue,
} from './comp-hid.js';
import {
  buildReverbBatch,
  buildReverbFrames,
  describeReverbHid,
  readReverb,
  REVERB_BYPASS,
  REVERB_FIELDS,
  REVERB_TYPES,
  typeCode,
} from './reverb-hid.js';
import { Q_MAX, Q_MIN } from './eq-scales.js';
import { describeScales } from './eq-scales.js';
import { checkModeConsistency, describeMode, detectModeFromHid } from './modes.js';
import { PRELUDE, ps } from './tools/uia.js';
import { createWorkspace, deleteWorkspace, switchWorkspace } from './workspace.js';
import { WorkspaceService } from './workspace-service.js';
import * as stateStore from './state-store.js';
import {
  buildAllLoopbackFrames,
  buildDuckMaskFrames,
  buildDuckingFrames,
  buildLoopbackFrames,
  describeDuckingLoopback,
  describeMask,
  DUCK_MASK,
  DUCK_SOURCES,
  LOOPBACK_PAIRS,
  LOOPBACK_PAIR_NAMES,
  sourceCode,
  dbToQ25,
  q25ToDb,
} from './duck-loopback-hid.js';
import {
  buildPhantomFrames,
  describePhantom,
  PHANTOM_CHANNELS,
  readPhantomState,
} from './phantom-hid.js';

const PORT = Number(process.env.M62_PORT ?? 8787);
const HOST = process.env.M62_HOST ?? '127.0.0.1';
/** Момент старта — для uptimeSec в /api/health. */
const STARTED_AT = Date.now();

const log = {
  info: (...a) => console.log('[m62]', ...a),
  warn: (...a) => console.warn('[m62]', ...a),
  error: (...a) => console.error('[m62]', ...a),
};

const transport = new M62Transport({ logger: log });
const controls = new ControlService(transport, { logger: log });
const settings = new SettingsService(transport, { logger: log });
const workspace = new WorkspaceService({ logger: log });

/** @type {Set<import('ws').WebSocket>} */
const clients = new Set();

/**
 * Последние значения метров: id -> {raw, db, atFloor, at}.
 * Нужно, чтобы фронт мог забрать текущий уровень одним запросом,
 * не поднимая WebSocket-поток.
 */
const lastMeters = new Map();

function broadcast(msg) {
  const s = JSON.stringify(msg);
  for (const c of clients) {
    if (c.readyState === 1) {
      try {
        c.send(s);
      } catch {
        /* клиент отвалился */
      }
    }
  }
}

// ---- события транспорта ----
transport.on('event', (ev) => {
  // 1) настройки устройства (TT=0x11, 0x45)
  const asSetting = settings.classify(ev);
  if (asSetting) {
    broadcast({ type: 'event', ...asSetting });
    return;
  }

  // 2) всё остальное по карте тегов (метры, эффекты, компрессор, EQ)
  const asTag = classifyTag(ev);
  if (asTag) {
    const extra = asTag.kind === 'meter'
      ? { meter: meterToDb(ev.value, asTag.name?.replace(/^Meter\s+/, '')) }
      : {};
    if (asTag.kind === 'meter') {
      lastMeters.set(asTag.id, {
        id: asTag.id,
        name: asTag.name,
        tag: `0x${(((ev.target << 8) | ev.prop)).toString(16).padStart(4, '0')}`,
        raw: ev.value,
        ...meterToDb(ev.value, asTag.name?.replace(/^Meter\s+/, '')),
        at: Date.now(),
      });
    }
    broadcast({
      type: 'event',
      ...ev,
      ...asTag,
      ...extra,
      // метры не кешируются как состояние — они шумят
      transient: asTag.kind === 'meter',
    });
    return;
  }

  // 3) громкости и селекторы
  broadcast({ type: 'event', ...controls.classify(ev) });
});

transport.on('error', (err) => {
  // ENODEV/EPROTO при выдёргивании кабеля — норма, не шумим.
  const code = err?.code ?? err?.errno;
  const benign = ['ENODEV', 'ESHUTDOWN', 'EPROTO', 'EILSEQ'];
  if (benign.includes(code)) {
    broadcast({ type: 'device', connected: false, reason: code });
    return;
  }
  log.warn('transport error:', err?.message ?? err);
  broadcast({ type: 'error', message: String(err?.message ?? err) });
});

transport.on('open', () => {
  broadcast({ type: 'device', connected: true });
});
transport.on('close', () => {
  broadcast({ type: 'device', connected: false });
});

// Автовосстановление после выдёргивания кабеля (проверено, NOTES §58).
transport.on('reconnected', () => {
  log.info?.('[m62] устройство восстановлено автоматически');
  broadcast({ type: 'device', connected: true, autoReconnected: true });
  settings.refresh({ waitMs: 3500 }).catch(() => {
    /* не критично */
  });
});

// ---- HTTP ----
function json(res, code, body) {  const s = JSON.stringify(body);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(s),
  });
  res.end(s);
}

/**
 * ═══ РАЗДАЧА СТАТИКИ ДЛЯ ВЕБ-КЛИЕНТА ═══
 *
 * Отдаём только два каталога и только безопасные расширения:
 *
 *     /            -> web/index.html
 *     /web/*       -> web/*
 *     /src/*       -> src/*   (клиент импортирует модули протокола)
 *
 * ЗАЩИТА ОТ ВЫХОДА ИЗ КАТАЛОГА: путь нормализуется, и итоговый
 * абсолютный путь обязан начинаться с корня проекта. Иначе `..`
 * позволил бы прочитать любой файл на диске.
 *
 * @returns {boolean} true, если ответ отправлен
 */
const STATIC_ROOT = resolve(process.cwd());
const STATIC_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};
/** Каталоги, которые разрешено отдавать. */
const STATIC_DIRS = ['web', 'src'];

/**
 * В `src/` есть модули только для Node (UIA, workspace, state-store).
 * Клиенту они не нужны и в браузере всё равно упадут — не отдаём.
 */
const STATIC_DENY = [
  '/src/tools/',
  '/src/ui-',
  '/src/workspace',
  '/src/state-store',
  '/src/snapshots',
  '/src/settings-service',
  '/src/eq-control',
  '/src/comp-control',
  '/src/audio-params',
  '/src/elevate',
  '/src/adapter-nodehid',
  '/src/transport.js',
  '/src/server.js',
  '/src/controls-service',
  '/src/modes',
  '/src/eq-mixer',
  // ВНИМАНИЕ: /src/eq-hp здесь БЫЛ — и это была ошибка.
  //
  // `eq-hp.js` не тянет ничего из Node (ноль импортов вообще): это
  // чистый модуль раскладки 10 полос × 2 канала. Страница его
  // импортирует — а сервер отвечал 404. В результате падал ВЕСЬ
  // модульный скрипт страницы (одна неудачная статическая загрузка
  // рушит весь граф), и не строился ни EQ входов, ни EQ наушников.
  //
  // Снаружи это выглядело как «JS не выполнился» без внятной
  // причины: карточки на месте, но пустые.
  '/src/eq-scales',
  '/src/comp-scales',
];

function serveStatic(pathname, res) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/web/index.html';

  // только разрешённые каталоги
  const first = rel.replace(/^\/+/, '').split('/')[0];
  if (!STATIC_DIRS.includes(first)) return false;

  // модули только для Node клиенту не отдаём
  if (STATIC_DENY.some((d) => rel.startsWith(d))) return false;

  const ext = extname(rel).toLowerCase();
  const type = STATIC_TYPES[ext];
  if (!type) return false;

  const abs = resolve(STATIC_ROOT, `.${rel}`);
  if (!abs.startsWith(STATIC_ROOT)) {
    json(res, 403, { ok: false, error: 'forbidden' });
    return true;
  }
  if (!existsSync(abs)) {
    json(res, 404, { ok: false, error: 'not found' });
    return true;
  }

  const body = readFileSync(abs);
  res.writeHead(200, {
    'content-type': type,
    'content-length': body.length,
    // протокол меняется — кеш только короткий
    'cache-control': 'no-cache',
  });
  res.end(body);
  return true;
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('плохой JSON в теле запроса');
  }
}

/**
 * Прочитать одну полосу EQ из workspace-файла.
 *
 * Формат определяется по ЧИСЛУ ПОЛЕЙ, а не по секции (NOTES §110/§111):
 *   5 полей: тип|gain|частота|Q|флаг
 *   4 поля: тип|частота|Q|gain
 *
 * @returns {{type:number, gain:number, freq:number, q:number, raw:string}|null}
 */
/**
 * Достаёт значение тега из снимка, понимая оба формата ключей.
 *
 * Ключи в снимке бывают hex ("9b:0f") и decimal ("155:15") —
 * `transport.snapshot()` пишет decimal, наши скрипты hex.
 * На этой путанице проект уже спотыкался (см. research/NOTES.md §134).
 */
function snapshotValue(snapshot, target, prop) {
  if (!snapshot) return undefined;
  const hexKey = `${target.toString(16).padStart(2, '0')}:${prop.toString(16).padStart(2, '0')}`;
  if (snapshot[hexKey] !== undefined) return snapshot[hexKey];
  const decKey = `${target}:${prop}`;
  if (snapshot[decKey] !== undefined) return snapshot[decKey];
  return undefined;
}

/**
 * Достаёт человеческое значение поля из строки полосы.
 *
 * Строки приходят из двух источников с разными именами полей:
 *   HID   (readChannelBands): { band, enable, type, gain, freq, q }
 *   файл  (readEqBandsFromWorkspace): { type, gain, freq, q }
 *
 * `param` — это имя поля в терминах API: gain | freq | q.
 */
function eqHumanFromRow(row, param) {
  if (!row) return null;
  const v = row[param];
  return v === undefined ? null : v;
}

/**
 * Округляет значение до той точности, которую держит устройство.
 *
 *   gain  — целые дБ
 *   freq  — целые Гц
 *   q     — 4 знака (устройство хранит Q x 10000)
 *
 * Без этого «delta 0.5» на gain дало бы значение, которое устройство
 * молча округлит в свою сторону, и ответ API разошёлся бы с фактом.
 */
function roundEqValue(param, value) {
  if (param === 'q') return Math.round(value * 10000) / 10000;
  return Math.round(value);
}

function readEqBandsFromWorkspace(which, band) {
  const ws = workspace.describe();
  if (!ws.available) return null;
  const blockId = which === 'IN2' ? 'EQ_IN2' : 'EQ_IN1';
  const block = (ws.eq ?? []).find((b) => b.id === blockId);
  if (!block) return null;
  const b = (block.bands ?? []).find((x) => x.band === band);
  if (!b) return null;
  return {
    type: b.type,
    typeName: EQ_LAYOUT.filterTypes[b.type] ?? null,
    gain: b.gain,
    freq: b.freq,
    q: b.q,
    raw: b.raw,
  };
}

/** Переключить TogglePattern по индексу элемента (для чекбоксов полос). */
function psEqToggle(index) {
  return ps(String.raw`
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$p = Get-Process -Name "M Control Center" -ErrorAction Stop | Select-Object -First 1
$cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $p.Id)
$tops = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)
$root = $null
for ($i = 0; $i -lt $tops.Count; $i++) {
  if ($tops.Item($i).Current.ClassName -eq "MainWindow_M62") { $root = $tops.Item($i); break }
}
if ($null -eq $root) { Write-Output "NO_WINDOW"; exit 1 }
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$e = $all.Item(${index})
$pat = $null
if ($e.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$pat)) {
  ([System.Windows.Automation.TogglePattern]$pat).Toggle()
  Write-Output "TOGGLED"
} else { Write-Output "NO_TOGGLE" }
`);
}

/**
 * Сменить тип фильтра полосы EQ РЕАЛЬНЫМ КЛИКОМ МЫШИ.
 *
 * Почему клик, а не UIA:
 *   - у комбобокса НЕТ SelectionPattern
 *   - ExpandCollapse.Expand() работает
 *   - у пунктов popup ЕСТЬ Invoke и SelectionItem, но НИ ОДИН из них
 *     не применяет выбор (проверено eq-set-type.js)
 *   - реальный клик мышью работает (eq-type-click.js)
 *
 * Координаты UIA уже ФИЗИЧЕСКИЕ, когда процесс DPI-aware.
 * Масштаб берём из PRELUDE и пересчитываем только если он != 1.
 */
function psEqComboSelect(band, typeName, which = 'IN1') {
  const safeType = typeName.replace(/'/g, "''");
  const script = PRELUDE + String.raw`
# 1. найти комбобокс нужной полосы
$root = Get-MccRoot
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$combos = @()
for ($i=0; $i -lt $all.Count; $i++) {
  $e = $all.Item($i)
  if ($e.Current.ClassName -ne 'ComboBoxS1M3') { continue }
  if ($e.Current.AutomationId -notlike '*EqWidgetIem.ComboBoxS1M3') { continue }
  $r = $e.Current.BoundingRectangle
  $combos += [pscustomobject]@{ i=$i; x=[int]($r.X+$r.Width/2); combo=$e }
}
if ($combos.Count -lt 4) { Write-Output "NO_COMBOS"; exit 1 }
$combos = $combos | Sort-Object x
$target = $combos[${band - 1}]

# 2. развернуть
$exp = $null
if ($target.combo.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$exp)) {
  ([System.Windows.Automation.ExpandCollapsePattern]$exp).Expand()
}
Start-Sleep -Milliseconds 900

# 3. найти пункт в popup (отдельное top-level окно)
$popupCond = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::ClassNameProperty, 'QComboBoxPrivateContainer')
$popup = [System.Windows.Automation.AutomationElement]::RootElement.FindFirst(
  [System.Windows.Automation.TreeScope]::Children, $popupCond)
if ($null -eq $popup) { Write-Output "NO_POPUP"; exit 1 }

$items = $popup.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$px = -1; $py = -1
for ($k = 0; $k -lt $items.Count; $k++) {
  $it = $items.Item($k)
  if ($it.Current.Name -ne '` + safeType + String.raw`') { continue }
  $r = $it.Current.BoundingRectangle
  $px = [int]($r.X + $r.Width/2)
  $py = [int]($r.Y + $r.Height/2)
}
if ($px -lt 0) { Write-Output "ITEM_NOT_FOUND"; exit 1 }

# 4. РЕАЛЬНЫЙ клик
if (-not $script:scale) { $script:scale = 1 }
$fx = [int]($px / $script:scale)
$fy = [int]($py / $script:scale)
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class MSEqSel {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
}
'@
[MSEqSel]::SetCursorPos($fx, $fy)
Start-Sleep -Milliseconds 200
[MSEqSel]::mouse_event(0x0002,0,0,0,[IntPtr]::Zero)
Start-Sleep -Milliseconds 60
[MSEqSel]::mouse_event(0x0004,0,0,0,[IntPtr]::Zero)
Write-Output ("CLICKED x=" + $fx + " y=" + $fy)
`;
  return ps(script).trim();
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // Разрешаем фронту на другом порту (dev-режим).
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', 'content-type');
  res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    if (req.method === 'GET' && url.pathname === '/api/health') {
      const mem = process.memoryUsage();
      const up = Math.round((Date.now() - STARTED_AT) / 1000);
      return json(res, 200, {
        ok: true,
        connected: Boolean(transport.device),
        stats: transport.stats,
        clients: clients.size,
        uptimeSec: up,
        memory: {
          rssMb: Math.round((mem.rss / 1024 / 1024) * 10) / 10,
          heapUsedMb: Math.round((mem.heapUsed / 1024 / 1024) * 10) / 10,
          heapTotalMb: Math.round((mem.heapTotal / 1024 / 1024) * 10) / 10,
        },
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/controls') {
      return json(res, 200, {
        ...controls.describe(),
        ...describeEqMixer(),
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/device') {
      const found = M62Transport.find();
      return json(res, 200, {
        connected: Boolean(transport.device),
        present: Boolean(found),
        product: found?.product ?? null,
        manufacturer: found?.manufacturer ?? null,
        interface: found?.interface ?? null,
        controls: controls.describe(),
        eqMixer: describeEqMixer(),
      });
    }

    // Только чтение каталога адресов EQ/микшера.
    // Записи сюда НЕТ намеренно: диапазоны не проверены, реакция устройства
    // неизвестна, а запись требует разрешения пользователя.
    if (req.method === 'GET' && url.pathname === '/api/eq-mixer') {
      return json(res, 200, { ok: true, ...describeEqMixer() });
    }

    // ---- МИКШЕР: расшифрованная карта ----
    //
    // Структура восстановлена из захвата USBPcap (docs/MIXER.md):
    //   5 шин x 11 источников, значение в Q25.
    // ═══ 48V (ФАНТОМ) ═══
    //
    // Команда найдена захватом 2026-11-10: 0x21:0x03 (1=вкл, 0=выкл).
    // Это ТОЛЬКО команда — устройство не сообщает состояние в потоке.
    //
    // ОПАСНО: фантом подаётся на микрофонный вход. Если подключена
    // линия или инструмент — можно повредить. Поэтому требуем
    // подтверждения и проверяем, что джек выглядит как микрофонный.

    if (req.method === 'GET' && url.pathname === '/api/phantom') {
      const snap = transport.snapshot();
      const state = {};
      for (const ch of PHANTOM_CHANNELS) {
        state[ch] = readPhantomState(snap, ch);
      }
      return json(res, 200, { ok: true, channels: state, ...describePhantom() });
    }

    if (req.method === 'POST' && url.pathname === '/api/phantom') {
      const body = await readBody(req);
      const channel = String(body.channel ?? 'IN1');
      if (!PHANTOM_CHANNELS.includes(channel)) {
        return json(res, 400, {
          ok: false,
          error: `неизвестный вход: ${channel}`,
          known: PHANTOM_CHANNELS,
        });
      }
      if (typeof body.on !== 'boolean') {
        return json(res, 400, {
          ok: false,
          error: 'укажи on: true или false',
          warning: 'фантом может повредить линейный вход или инструмент',
        });
      }
      if (body.confirm !== true) {
        return json(res, 400, {
          ok: false,
          error: 'фантомное питание требует подтверждения',
          hint: 'передайте confirm: true, если уверены, что к входу '
            + 'подключён микрофон, а не линия или инструмент',
        });
      }
      if (!transport.isOpen?.() && !transport.device) {
        return json(res, 503, { ok: false, error: 'устройство не открыто', hint: 'POST /api/connect' });
      }
      try {
        const frames = buildPhantomFrames(channel, body.on);
        const out = transport.writeFrames(frames);
        stateStore.update('prefs', { [`phantom_${channel}`]: body.on });
        broadcast({ type: 'ack', op: 'phantom', channel, on: body.on, via: 'hid' });
        return json(res, 200, {
          ok: true,
          channel,
          on: body.on,
          via: 'hid',
          frames: out.frames,
          stateKnown: false,
          note: '48V — команда без обратной связи. Устройство не сообщает '
            + 'изменение в потоке, состояние хранится у клиента.',
        });
      } catch (err) {
        return json(res, 400, { ok: false, error: String(err?.message ?? err) });
      }
    }

    // ═══ ЗАПИСЬ DUCKING И LOOPBACK В УСТРОЙСТВО ═══
    //
    // До 2026-11-10 этих маршрутов не было: состояние только хранилось
    // в файле (`/api/state/ducking`, `/api/state/loopback`). Протокол
    // записи проверен скриптом-пробой, теперь вынесен в бекенд.
    //
    // ОГРАНИЧЕНИЕ: обратного чтения нет (`IN=0` во всех захватах).
    // Запись принимается, но подтвердить применение можно только
    // захватом USBPcap. Ответ поэтому говорит applied: 'unknown'.

    if (req.method === 'POST' && url.pathname === '/api/ducking') {
      const body = await readBody(req);
      if (!body.values || typeof body.values !== 'object') {
        return json(res, 400, {
          ok: false,
          error: 'нужно поле values: { threshold, attack, reduction, release, switch, maskLo, maskHi }',
        });
      }
      if (!transport.isOpen?.() && !transport.device) {
        return json(res, 503, { ok: false, error: 'устройство не открыто', hint: 'POST /api/connect' });
      }
      try {
        const frames = buildDuckingFrames(body.values);
        const out = transport.writeFrames(frames);
        // сохраняем в своё хранилище: из устройства не прочитать
        stateStore.setDucking(body.values);
        broadcast({ type: 'ack', op: 'ducking', values: body.values, via: 'hid' });
        return json(res, 200, {
          ok: true,
          via: 'hid',
          frames: out.frames,
          values: body.values,
          applied: 'unknown',
          note: 'ducking не читается из устройства — подтвердить применение можно только захватом',
        });
      } catch (err) {
        return json(res, 400, { ok: false, error: String(err?.message ?? err) });
      }
    }

    // ═══ МАСКА DUCKING: КАКИЕ ИСТОЧНИКИ ПРИГЛУШАЮТСЯ ═══
    //
    // Две маски по 8 бит: 0x43:0x05 = IN1, 0x43:0x06 = IN2.
    // Порядок битов доказан захватом 2026-11-13 (3 шаблона, 100%
    // совпадение): бит = порядок флагов в секции [Ducking] INI.
    //
    // Принимаем имена источников, а не только числа — в отличие от
    // старого /api/ducking, где маска задавалась как maskLo/maskHi.
    if (req.method === 'POST' && url.pathname === '/api/ducking/mask') {
      const body = await readBody(req);
      const hasIn1 = body.in1 !== undefined && body.in1 !== null;
      const hasIn2 = body.in2 !== undefined && body.in2 !== null;
      if (!hasIn1 && !hasIn2) {
        return json(res, 400, {
          ok: false,
          error: 'нужно поле in1 и/или in2: массив источников или число 0..255',
          sources: DUCK_SOURCES,
          example: { in1: ['AUX', 'BT'], in2: ['Playback 1/2'] },
        });
      }
      if (!transport.isOpen?.() && !transport.device) {
        return json(res, 503, { ok: false, error: 'устройство не открыто', hint: 'POST /api/connect' });
      }
      try {
        const frames = buildDuckMaskFrames({ in1: body.in1, in2: body.in2 });
        const out = transport.writeFrames(frames);
        const result = {};
        for (const f of frames) {
          const side = f.prop === DUCK_MASK.in1.prop ? 'in1' : 'in2';
          result[side] = describeMask(f.value);
        }
        broadcast({ type: 'ack', op: 'ducking-mask', result, via: 'hid' });
        return json(res, 200, {
          ok: true,
          via: 'hid',
          frames: out.frames,
          masks: result,
          applied: 'unknown',
          note: 'маска ducking не читается из устройства — подтвердить применение можно только захватом',
        });
      } catch (err) {
        return json(res, 400, {
          ok: false,
          error: String(err?.message ?? err),
          sources: DUCK_SOURCES,
        });
      }
    }

    // Справочник по маске: биты, источники, адреса.
    if (req.method === 'GET' && url.pathname === '/api/ducking/mask') {
      const q = url.searchParams;
      // без параметров — справочник; с ?value=N — расшифровка байта
      if (q.has('value')) {
        const n = Number(q.get('value'));
        if (!Number.isInteger(n) || n < 0 || n > 255) {
          return json(res, 400, { ok: false, error: 'value должно быть 0..255' });
        }
        return json(res, 200, { ok: true, mask: describeMask(n) });
      }
      return json(res, 200, {
        ok: true,
        address: { in1: '0x43:0x05', in2: '0x43:0x06' },
        bits: DUCK_MASK.knownBits,
        sources: DUCK_SOURCES,
        geometry: {
          in1: describeMask(170),
          in2: describeMask(84),
          all: 255,
          none: 0,
        },
        note: 'бит = порядок флагов в секции [Ducking] INI; доказано захватом 2026-11-13',
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/loopback') {
      const body = await readBody(req);

      // Две формы: одна пара {pair, source, gainDb} или всё сразу {pairs:{...}}
      let frames;
      let saved;
      if (body.pairs && typeof body.pairs === 'object') {
        frames = buildAllLoopbackFrames(body.pairs);
        saved = body.pairs;
      } else {
        const pair = String(body.pair ?? '');
        if (!LOOPBACK_PAIRS[pair]) {
          return json(res, 400, {
            ok: false,
            error: `неизвестная пара: ${pair || '(не указана)'}`,
            known: LOOPBACK_PAIR_NAMES,
            hint: 'можно передать {pairs:{lb12:{source:"FX",gainDb:0}}} для нескольких сразу',
          });
        }
        frames = buildLoopbackFrames(pair, { source: body.source, gainDb: body.gainDb });
        saved = { [pair]: { source: body.source, gainDb: body.gainDb } };
      }

      if (!transport.isOpen?.() && !transport.device) {
        return json(res, 503, { ok: false, error: 'устройство не открыто', hint: 'POST /api/connect' });
      }
      try {
        const out = transport.writeFrames(frames);
        stateStore.setLoopback(saved);
        broadcast({ type: 'ack', op: 'loopback', pairs: saved, via: 'hid' });
        return json(res, 200, {
          ok: true,
          via: 'hid',
          frames: out.frames,
          pairs: saved,
          applied: 'unknown',
          note: 'loopback не читается из устройства — подтвердить применение можно только захватом',
        });
      } catch (err) {
        return json(res, 400, { ok: false, error: String(err?.message ?? err) });
      }
    }

    // Справочник по ducking и loopback: адреса, коды источников, шкала.
    if (req.method === 'GET' && url.pathname === '/api/duck-loopback') {
      return json(res, 200, { ok: true, ...describeDuckingLoopback() });
    }

    // ═══ СОБСТВЕННОЕ ХРАНИЛИЩЕ СОСТОЯНИЯ ═══
    //
    // Микшер, loopback и ducking из устройства не читаются (IN=0 во
    // всех захватах). Раньше их состоянием был workspace-INI MCC, что
    // привязывало бекенд к установленному M Control Center.
    //
    // Теперь это отдельный JSON в %APPDATA%\m62\state.json.
    // MCC не нужен ни запущенным, ни установленным.
    if (req.method === 'GET' && url.pathname === '/api/state') {
      return json(res, 200, { ok: true, ...stateStore.describe() });
    }

    // Полное содержимое состояния (микшер, loopback, ducking).
    if (req.method === 'GET' && url.pathname === '/api/state/full') {
      const st = stateStore.load();
      return json(res, 200, { ok: true, state: st });
    }

    // Импорт из workspace MCC (однократно, для миграции).
    if (req.method === 'POST' && url.pathname === '/api/state/import') {
      try {
        const ws = workspace.describe();
        if (!ws.available) {
          return json(res, 400, {
            ok: false,
            error: 'workspace MCC недоступен — импортировать нечего',
            hint: 'если MCC не установлен, состояние начнётся с пустого',
          });
        }
        const out = stateStore.importFromWorkspace(ws);
        workspace.invalidate();
        broadcast({ type: 'ack', op: 'state-import', ...out });
        return json(res, 200, { ok: true, ...out, ...stateStore.describe() });
      } catch (err) {
        return json(res, 400, { ok: false, error: String(err?.message ?? err) });
      }
    }

    // Сохранить матрицу микшера в своё хранилище (без записи в устройство).
    if (req.method === 'POST' && url.pathname === '/api/state/mixer') {
      const body = await readBody(req);
      if (!body.buses || typeof body.buses !== 'object') {
        return json(res, 400, { ok: false, error: 'нужно поле buses: { bus: { source: db } }' });
      }
      try {
        const st = stateStore.setMixer(body.buses);
        broadcast({ type: 'ack', op: 'state-mixer' });
        return json(res, 200, { ok: true, buses: Object.keys(st.mixer.buses).length });
      } catch (err) {
        return json(res, 400, { ok: false, error: String(err?.message ?? err) });
      }
    }

    // Сохранить loopback в своё хранилище.
    if (req.method === 'POST' && url.pathname === '/api/state/loopback') {
      const body = await readBody(req);
      if (!body.pairs || typeof body.pairs !== 'object') {
        return json(res, 400, { ok: false, error: 'нужно поле pairs: { lb12: { source, gain } }' });
      }
      try {
        const st = stateStore.setLoopback(body.pairs);
        broadcast({ type: 'ack', op: 'state-loopback' });
        return json(res, 200, { ok: true, pairs: Object.keys(st.loopback.pairs).length });
      } catch (err) {
        return json(res, 400, { ok: false, error: String(err?.message ?? err) });
      }
    }

    // Сохранить ducking в своё хранилище.
    if (req.method === 'POST' && url.pathname === '/api/state/ducking') {
      const body = await readBody(req);
      if (!body.values || typeof body.values !== 'object') {
        return json(res, 400, { ok: false, error: 'нужно поле values: { ... }' });
      }
      try {
        const st = stateStore.setDucking(body.values);
        broadcast({ type: 'ack', op: 'state-ducking' });
        return json(res, 200, { ok: true, keys: Object.keys(st.ducking.values).length });
      } catch (err) {
        return json(res, 400, { ok: false, error: String(err?.message ?? err) });
      }
    }

    //   Пишется ТОЛЬКО пакетом внутри bulk push (0x11:0x20).
    //   Обратно НЕ читается — состояние хранит клиент.
    if (req.method === 'GET' && url.pathname === '/api/mixer') {
      return json(res, 200, { ok: true, ...describeMixer() });
    }

    if (req.method === 'POST' && url.pathname === '/api/mixer') {
      const body = await readBody(req);
      // state: { busName: { sourceId: db } }
      if (!body.state || typeof body.state !== 'object') {
        return json(res, 400, {
          ok: false,
          error: 'нужено поле state: { bus: { source: db } }',
        });
      }
      try {
        const out = transport.writeMixer(body.state, { announce: body.announce !== false });
        broadcast({ type: 'ack', op: 'mixer', ...out });
        return json(res, 200, { ok: true, ...out });
      } catch (err) {
        return json(res, 400, { ok: false, error: err.message });
      }
    }

    // ---- EQ НАУШНИКОВ (0xa1..0xaa) ----
    //
    // ТОЛЬКО в Prof-режиме: в Live и Mobile этих блоков нет вообще.
    // 10 полос × 2 канала × 5 полей (вкл, тип, gain, частота, Q).
    //
    // ВАЖНО: в Prof блоки приходят на 7-11 секунде после подписки.
    // Если снимок короче 26 с — блоков в нём не будет, и это можно
    // спутать с «запись не применилась».
    if (req.method === 'GET' && url.pathname === '/api/eq-hp') {
      // Режим определяем по HID-семействам: 0xa1..0xaa есть только в Prof.
      // ВАЖНО: detectModeFromHid возвращает ОБЪЕКТ { mode, confidence, ... },
      // а не строку — берём .mode.
      const detected = detectModeFromHid(transport.snapshot());
      const modeName = detected?.mode ?? null;
      const available = modeName === 'Prof';
      const bandList = available ? readAllBands(transport.snapshot()) : [];
      return json(res, 200, {
        ok: true,
        mode: modeName,
        modeDetail: detected,
        available,
        bandCount: EQ_HP_BANDS,
        bands: bandList,
        ...describeEqHp(),
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/eq-hp') {
      const body = await readBody(req);
      const band = Number(body.band);
      if (!Number.isInteger(band) || band < 1 || band > EQ_HP_BANDS) {
        return json(res, 400, {
          ok: false,
          error: `band должен быть 1..${EQ_HP_BANDS}`,
        });
      }
      try {
        const frames = buildBandFrames(band, { l: body.l, r: body.r });
        if (!frames.length) {
          return json(res, 400, {
            ok: false,
            error: 'нужно указать l и/или r с полями enable/type/gain/freq/q',
          });
        }
        for (const f of frames) {
          transport.send(f.target, f.prop, f.value);
        }
        broadcast({ type: 'ack', op: 'eq-hp', band, frames: frames.length });
        return json(res, 200, { ok: true, band, frames: frames.length });
      } catch (err) {
        return json(res, 400, { ok: false, error: err.message });
      }
    }

    // Полное состояние через Load preset — единственный способ получить
    // теги компрессора 0x46:0x01..0x08 (проверено, NOTES §44).
    // ⚠️ Побочный эффект: загружает пресет, состояние меняется.
    if (req.method === 'POST' && url.pathname === '/api/settings/full-state') {
      const body = await readBody(req);
      if (body.confirm !== true) {
        return json(res, 400, {
          ok: false,
          error: 'это загрузит preset и изменит состояние устройства; передайте confirm: true',
        });
      }
      const out = await settings.loadFullState({ which: body.which === 2 ? 2 : 1 });
      return json(res, 200, { ok: true, ...out, loadedPreset: body.which === 2 ? 2 : 1 });
    }

    // ---- настройки устройства ----
    if (req.method === 'GET' && url.pathname === '/api/settings') {
      // ?refresh=1 — заново запросить состояние у устройства
      if (url.searchParams.get('refresh') === '1') {
        const out = await settings.refresh();
        return json(res, 200, { ok: true, ...out });
      }
      return json(res, 200, { ok: true, ...settings.describe() });
    }

    // Живые уровни всех метров в дБ (последнее значение каждого).
    if (req.method === 'GET' && url.pathname === '/api/meters') {
      const now = Date.now();
      const meters = [...lastMeters.values()]
        .map((m) => ({
          id: m.id,
          name: m.name,
          tag: m.tag,
          raw: m.raw,
          db: m.db,
          atFloor: m.atFloor,
          noData: m.noData,
          ageMs: now - m.at,
        }))
        .sort((a, b) => a.id.localeCompare(b.id));

      // Редукция компрессора: разница между уровнем после и до.
      const byId = new Map(meters.map((m) => [m.id, m]));
      const before = byId.get(`meter_${COMP_METER_ROLES.before}`);
      const after = byId.get(`meter_${COMP_METER_ROLES.after}`);
      const gainReduction = (before && after)
        ? {
          db: gainReductionDb(before.raw, after.raw),
          beforeDb: before.db,
          afterDb: after.db,
          note: 'отрицательное = компрессор сжимает',
        }
        : null;

      return json(res, 200, {
        ok: true,
        scale: { ...meterUnits(), floorRaw: METER_SCALE.floorRaw },
        meters,
        gainReduction,
      });
    }

    // Карта всех известных тегов — для фронта и отладки.
    if (req.method === 'GET' && url.pathname === '/api/tags') {      return json(res, 200, {
        ok: true,
        ...describeTags(),
        meterScale: { ...meterUnits(), floorRaw: METER_SCALE.floorRaw },
      });
    }

    // ---- workspace: микшер, EQ, 48V, loopback ----
    if (req.method === 'GET' && url.pathname === '/api/workspace') {
      if (url.searchParams.get('refresh') === '1') workspace.invalidate();
      return json(res, 200, { ok: true, ...workspace.describe() });
    }

    if (req.method === 'GET' && url.pathname === '/api/workspaces') {
      return json(res, 200, { ok: true, list: workspace.list() });
    }

    // ---- управление workspace (создание, удаление, переключение) ----
    // Проверено: workspace — это INI-файл, создаётся копированием (NOTES §67).
    if (req.method === 'POST' && url.pathname === '/api/workspaces/create') {
      const body = await readBody(req);
      const out = createWorkspace(
        { mode: body.mode, name: body.name },
        { from: body.from, sourceMode: body.sourceMode },
      );
      workspace.invalidate();
      broadcast({ type: 'ack', op: 'workspace-create', ...out });
      return json(res, 200, { ok: true, ...out });
    }

    if (req.method === 'POST' && url.pathname === '/api/workspaces/delete') {
      const body = await readBody(req);
      const out = deleteWorkspace({ mode: body.mode, name: body.name });
      workspace.invalidate();
      broadcast({ type: 'ack', op: 'workspace-delete', ...out });
      return json(res, 200, { ok: true, ...out });
    }

    if (req.method === 'POST' && url.pathname === '/api/workspaces/switch') {
      const body = await readBody(req);
      const out = switchWorkspace({ mode: body.mode, name: body.name });
      broadcast({ type: 'ack', op: 'workspace-switch', ...out });
      return json(res, 200, { ok: true, ...out });
    }

    // Режим устройства и что в нём доступно (тег 0x11:0x1d не читается —
    // определяем косвенно, см. src/modes.js).
    if (req.method === 'GET' && url.pathname === '/api/mode') {
      const ws = workspace.describe();
      const base = describeMode(ws.available ? ws : null);
      // Проверяем рассинхронизацию: workspace против реальных HID-семейств
      // (проверено, NOTES §84 — файл и реестр могут врать).
      let consistency = null;
      try {
        consistency = checkModeConsistency(
          ws.available ? ws : {},
          transport.snapshot(),
        );
      } catch {
        /* диагностика не критична */
      }
      return json(res, 200, { ok: true, ...base, consistency });
    }

    // Смена режима — ОПАСНАЯ операция (проверено, NOTES §84):
    // при работающем MCC состояние рассинхронизируется.
    // Требует confirm, останавливает MCC, проверяет результат по HID.
    if (req.method === 'POST' && url.pathname === '/api/mode') {
      const body = await readBody(req);
      if (!body.mode) return json(res, 400, { ok: false, error: 'укажи mode (Mobile|Live|Prof)' });
      if (body.confirm !== true) {
        return json(res, 400, {
          ok: false,
          error: 'смена режима перезагружает устройство и может рассинхронизировать '
            + 'состояние; передайте confirm: true',
        });
      }
      const out = await settings.setMode(body.mode, {
        waitMs: body.waitMs,
        // mccFriendly по умолчанию FALSE: проверено 2026-11-10,
        // что устройство перезагружается и восстанавливается само.
        // Передайте mccFriendly: true, если нужен MCC вокруг смены.
        mccFriendly: body.mccFriendly === true,
        verify: body.verify !== false,
      });
      workspace.invalidate();
      broadcast({ type: 'ack', op: 'mode', ...out });
      return json(res, 200, { ok: true, ...out });
    }

    // Запись в workspace через перезапуск MCC (проверено, research/WRITE-METHOD.md).
    // ВНИМАНИЕ: это перезапускает M Control Center — долгая операция (~17 с).
    if (req.method === 'POST' && url.pathname === '/api/workspace/apply') {
      const body = await readBody(req);
      const changes = Array.isArray(body.changes)
        ? body.changes
        : [{ section: body.section, key: body.key, value: body.value }];
      const out = await workspace.applyChanges(changes, {
        restart: body.restart !== false,
      });
      broadcast({ type: 'ack', op: 'workspace-apply', ...out });
      return json(res, 200, { ok: true, ...out });
    }

    // ---- UI-управление: реверб и компрессор ----
    if (req.method === 'GET' && url.pathname === '/api/ui-controls') {
      return json(res, 200, { ok: true, ...describeUiControls() });
    }

    // ---- снимки состояния (своя реализация полного снапшота) ----
    if (req.method === 'GET' && url.pathname === '/api/snapshots') {
      return json(res, 200, { ok: true, list: listSnapshots() });
    }

    if (req.method === 'POST' && url.pathname === '/api/snapshots') {
      const body = await readBody(req);
      const out = await captureSnapshot(transport, workspace, { label: body.label ?? '' });
      broadcast({ type: 'ack', op: 'snapshot', ...out });
      return json(res, 200, { ok: true, ...out });
    }

    if (req.method === 'GET' && url.pathname === '/api/snapshots/get') {
      const f = url.searchParams.get('file');
      if (!f) return json(res, 400, { ok: false, error: 'укажи ?file=' });
      try {
        return json(res, 200, { ok: true, snapshot: readSnapshot(f) });
      } catch (err) {
        return json(res, 404, { ok: false, error: String(err.message) });
      }
    }

    if (req.method === 'GET' && url.pathname === '/api/snapshots/diff') {
      const a = url.searchParams.get('a');
      const b = url.searchParams.get('b');
      if (!a || !b) return json(res, 400, { ok: false, error: 'укажи ?a= и ?b=' });
      try {
        return json(res, 200, { ok: true, diff: diffSnapshots(readSnapshot(a), readSnapshot(b)) });
      } catch (err) {
        return json(res, 404, { ok: false, error: String(err.message) });
      }
    }

    if (req.method === 'POST' && url.pathname === '/api/snapshots/apply') {
      const body = await readBody(req);
      if (!body.file) return json(res, 400, { ok: false, error: 'укажи file' });
      const snap = readSnapshot(body.file);
      const out = await applySnapshot(transport, workspace, snap, {
        applyWorkspace: body.applyWorkspace !== false,
      });
      broadcast({ type: 'ack', op: 'snapshot-apply', ...out });
      return json(res, 200, { ok: true, ...out });
    }

    if (req.method === 'POST' && url.pathname === '/api/snapshots/delete') {
      const body = await readBody(req);
      if (!body.file) return json(res, 400, { ok: false, error: 'укажи file' });
      try {
        return json(res, 200, { ok: true, ...deleteSnapshot(body.file) });
      } catch (err) {
        return json(res, 404, { ok: false, error: String(err.message) });
      }
    }

    // ═══ РЕВЕРБ ЧЕРЕЗ HID ═══
    //
    // Проверено 2026-11-10: пишется прямой записью в 0x44, окно MCC
    // не нужно. Карта из дизассемблера MCC (NOTES §11.5):
    //
    //   0x44:08 DryWet   0x44:09 Room   0x44:0a Decay
    //   0x44:0b тип      0x44:0c MuteFX 0x44:0f Width (x100)
    //
    // ЛОВУШКА: при типе Bypass (1) параметры НЕ принимаются —
    // устройство молча их игнорирует. Именно из-за этого первая
    // проверка дала ложный вывод «реверб не пишется через HID».
    // Правильный порядок: сначала включить тип, потом параметры.
    if (req.method === 'POST' && url.pathname === '/api/reverb') {
      const body = await readBody(req);
      if (!transport.isOpen?.() && !transport.device) {
        return json(res, 503, { ok: false, error: 'устройство не открыто', hint: 'POST /api/connect' });
      }
      try {
        const code = typeCode(body.type);
        const snap = transport.snapshot();
        const before = readReverb(snap);
        const frames = buildReverbFrames('type', code);
        const out = transport.writeFrames(frames);
        broadcast({ type: 'ack', op: 'reverb', type: body.type, code, via: 'hid' });
        return json(res, 200, {
          ok: true,
          type: REVERB_TYPES[code],
          code,
          before: before.typeName,
          via: 'hid',
          frames: out.frames,
        });
      } catch (err) {
        return json(res, 400, { ok: false, error: String(err?.message ?? err) });
      }
    }

    // Параметры реверба: DryWet / Room / Decay / Width.
    //
    // Принимаем value (абсолютное) и delta (относительное — оставлено
    // для совместимости с прежним API).
    if (req.method === 'POST' && url.pathname === '/api/reverb/param') {
      const body = await readBody(req);
      if (!body.param) return json(res, 400, { ok: false, error: 'укажи param' });
      if (!transport.isOpen?.() && !transport.device) {
        return json(res, 503, { ok: false, error: 'устройство не открыто', hint: 'POST /api/connect' });
      }
      try {
        const field = String(body.param);
        if (!REVERB_FIELDS[field] || field === 'type' || field === 'muteFx') {
          return json(res, 400, {
            ok: false,
            error: `неизвестный параметр: ${field}`,
            known: ['dryWet', 'room', 'decay', 'width'],
            hint: 'тип реверба меняется через POST /api/reverb',
          });
        }

        const snap = transport.snapshot();
        const cur = readReverb(snap);

        // ГЛАВНОЕ: при Bypass параметры не применяются. Не делаем вид,
        // что записали — говорим прямо.
        if (cur.bypass) {
          return json(res, 409, {
            ok: false,
            error: 'реверб в Bypass — параметры не применяются',
            hint: 'сначала включите тип: POST /api/reverb {type:"LIVE"}',
            currentType: cur.typeName,
          });
        }

        let target;
        if (body.value !== undefined && body.value !== null) {
          target = Number(body.value);
        } else if (body.delta !== undefined) {
          const d = Number(body.delta);
          if (!Number.isFinite(d) || d === 0) {
            return json(res, 400, { ok: false, error: 'delta должно быть числом ≠ 0' });
          }
          const curVal = cur[field];
          if (curVal === null || curVal === undefined) {
            return json(res, 409, { ok: false, error: `текущее значение ${field} неизвестно — задайте value` });
          }
          target = field === 'width' ? curVal + d : curVal + d;
        } else {
          return json(res, 400, { ok: false, error: 'нужен value или delta' });
        }

        // Width в API дробный (0..1), в устройстве x100.
        const frames = buildReverbFrames(field, target);
        const out = transport.writeFrames(frames);
        broadcast({
          type: 'ack', op: 'reverb-param', param: field,
          before: cur[field], after: target, via: 'hid',
        });
        return json(res, 200, {
          ok: true,
          param: field,
          before: cur[field],
          after: target,
          via: 'hid',
          frames: out.frames,
        });
      } catch (err) {
        return json(res, 400, { ok: false, error: String(err?.message ?? err) });
      }
    }

    // Аудиопараметры драйвера: sample rate и buffer size.
    // ═══ АУДИОПАРАМЕТРЫ: ЧТЕНИЕ БЕЗ MCC ═══
    //
    // ДО 2026-11-13 этот маршрут был единственным из 69, который
    // падал без запущенного MCC: он читал комбобоксы окна через
    // UI Automation. Теперь sample rate берётся из реестра
    // (MMDevices\Audio\{Render|Capture}\{GUID}\Properties), а он
    // читается всегда — MCC не нужен ни запущенным, ни установленным.
    //
    // ЗАПИСЬ по-прежнему невозможна: ACE с флагом CIID даёт
    // администраторам права только на дочерние ключи. Проверено
    // при admin=True/High integrity. См. NOTES §149.4.
    if (req.method === 'GET' && url.pathname === '/api/audio-params') {
      try {
        const cur = readAllAudioParams();
        return json(res, 200, {
          ok: true,
          via: 'registry',
          mccRequired: false,
          current: cur,
          options: AUDIO_OPTIONS_FOR_API,
          caveats: [
            'sample rate читается из реестра Windows — MCC не нужен',
            'у M62 несколько эндпоинтов, у каждого своя частота: '
              + 'current.sampleRate = массив, если они различаются',
            'устройство задаёт частоту на каждый поток отдельно, '
              + '"одной частоты устройства" не существует',
            'buffer size в реестре нет — он в драйвере',
            'ЗАПИСЬ sample rate заблокирована системой (см. POST)',
          ],
        });
      } catch (err) {
        return json(res, 500, { ok: false, error: String(err?.message ?? err) });
      }
    }

    if (req.method === 'POST' && url.pathname === '/api/audio-params') {
      const body = await readBody(req);
      if (!body.name) return json(res, 400, { ok: false, error: 'укажи name (sampleRate|bufferSize)' });
      if (body.value === undefined) return json(res, 400, { ok: false, error: 'укажи value' });
      try {
        const out = setAudioParam(String(body.name), Number(body.value));
        // applied=false — это НЕ ошибка запроса, а честный отказ системы.
        // 200 с ok:false, потому что маршрут отработал, но применить нельзя.
        if (!out.ok) {
          return json(res, 200, {
            ok: false,
            applied: false,
            ...out,
            note: 'это ограничение Windows, а не бекенда — см. howTo',
          });
        }
        broadcast({ type: 'ack', op: 'audio-param', ...out });
        return json(res, 200, { ok: true, ...out });
      } catch (err) {
        return json(res, 400, { ok: false, error: String(err?.message ?? err) });
      }
    }
    if (req.method === 'GET' && url.pathname === '/api/reverb') {
      // ═══ ЧТЕНИЕ ЧЕРЕЗ HID ═══
      //
      // Все параметры реверба приходят тегами 0x44 — файл MCC не нужен.
      const snap = transport.snapshot();
      const cur = readReverb(snap);
      const anyHid = Object.entries(cur)
        .some(([k, v]) => !['typeName', 'bypass'].includes(k) && v !== null && v !== undefined);

      return json(res, 200, {
        ok: true,
        via: 'hid',
        types: Object.keys(REVERB_TYPES).map((c) => REVERB_TYPES[c]),
        typeCodes: REVERB_TYPES,
        params: ['dryWet', 'room', 'decay', 'width'],
        current: anyHid ? cur : null,
        hid: describeReverbHid(),
        caveats: [
          'ПРИ Bypass параметры НЕ применяются — сначала выберите тип '
            + '(это же верно для дилов в самом MCC, NOTES §71)',
          'Width задаётся дробным 0..1 в API, в устройство уходит как x100',
          'MCC не нужен: чтение и запись идут через HID',
        ],
      });
    }

    // EQ через UI MCC. ВАЖНО: Switch и типы фильтров хранятся ТОЛЬКО в UI
    // (файл врёт Switch=1, HID не отдаёт вовсе) — NOTES §94/§97.
    if (req.method === 'GET' && url.pathname === '/api/eq') {
      try {
        // ═══ ЧТЕНИЕ ЧЕРЕЗ HID ═══
        //
        // Раньше включение EQ читалось через UIAutomation (кнопка в окне
        // MCC), поэтому без MCC маршрут падал. Теперь — из тегов
        // 0x9b:0x0f / 0x9b:0x10.
        const snap = transport.snapshot();
        const sw = (prop) => {
          const v = snapshotValue(snap, 0x9b, prop);
          return {
            enabled: v === 1,
            raw: v ?? null,
            source: v === undefined ? 'нет тега' : 'hid',
          };
        };
        const in1 = { input: 'IN1', ...sw(0x0f) };
        const in2 = { input: 'IN2', ...sw(0x10) };

        const body = {
          ok: true,
          via: 'hid',
          windowOpen: (() => {
            try { return isEqWindowOpen(); } catch { return false; }
          })(),
          switches: { in1, in2 },
          bands: {
            IN1: readChannelBands(snap, 'IN1'),
            IN2: readChannelBands(snap, 'IN2'),
          },
          hid: describeEqHid(),
          ...describeEq(),
        };
        // Типы фильтров теперь тоже из HID (свойство 0x02/0x07) —
        // отдельный путь через окно больше не нужен.
        return json(res, 200, body);
      } catch (err) {
        return json(res, 400, { ok: false, error: String(err?.message ?? err) });
      }
    }


    // ═══════════════════════════════════════════════════════════════
    // EQ НА ВХОДАХ: ЗАПИСЬ РАБОТАЕТ (доказано 2026-11-13)
    // ═══════════════════════════════════════════════════════════════
    //
    // ═══ КАК ЭТО БЫЛО ВЫЯСНЕНО ═══
    //
    // Сначала девять способов дали «не принято», и я записал EQ в
    // read-only. Это было НЕВЕРНО, и вот что оказалось на самом деле.
    //
    // Промах №1. Сессия обрывалась сразу после записи. Прошивка
    // коммитит live-состояние НЕ МГНОВЕННО. Замерено (удержание
    // сессии открытой -> чтение через дамп):
    //
    //     держу 0.5 с, gain=2  -> дамп показывает 11   ПОТЕРЯНО
    //     держу 1.0 с, gain=3  -> дамп показывает 11   ПОТЕРЯНО
    //     держу 1.5 с, gain=4  -> дамп показывает 11   ПОТЕРЯНО
    //     держу 2.0 с, gain=5  -> дамп показывает 5    ПРИМЕНЕНО
    //     держу 2.5 с, gain=6  -> дамп показывает 6    ПРИМЕНЕНО
    //     держу 3/6/10/15 с    -> всё применено
    //
    // Минимальный порог — 2 СЕКУНДЫ.
    //
    // Промах №2. Результат читали обычным ANNOUNCE. Блоки EQ
    // (0x91..0x94, 0xa1..0xaa) приходят ТОЛЬКО в ответ на 0x11:26
    // (дамп DSP-блоков), который завершается 0x11:25 через ~3 с.
    // Обычный ANNOUNCE их не несёт — поэтому значение «не менялось».
    //
    // Правильный путь: `transport.writeEqWithCommit()` — пишет,
    // держит сессию 2.5 с, затем запрашивает дамп.
    //
    // Это же объясняет, почему MCC сам ни разу не писал в 0x91..0x94
    // в наших захватах: он пишет EQ в начале сессии, а мы ловили
    // уже установившееся состояние.
    const EQ_INPUT_WRITE_ROUTES = new Set([
      '/api/eq/switch',
      '/api/eq/band',
      '/api/eq/band/enable',
      '/api/eq/type',
    ]);

    if (
      req.method === 'POST'
      && EQ_INPUT_WRITE_ROUTES.has(url.pathname)
      && (transport.isOpen?.() || transport.device)
    ) {
      const body = await readBody(req);
      const which = body.input === 'IN2' ? 'IN2' : 'IN1';

      // Собираем кадры под конкретный маршрут.
      let frames = null;
      try {
        if (url.pathname === '/api/eq/band') {
          const band = Number(body.band);
          const param = String(body.param ?? '');
          if (!Number.isInteger(band) || band < 1 || band > 4) {
            return json(res, 400, { ok: false, error: 'band должен быть 1..4' });
          }
          if (!['gain', 'freq', 'q'].includes(param)) {
            return json(res, 400, { ok: false, error: 'param должен быть gain | freq | q' });
          }
          if (!Number.isFinite(Number(body.value))) {
            return json(res, 400, { ok: false, error: 'нужно value (число)' });
          }
          frames = buildEqFrames(which, band, param, Number(body.value));
        } else if (url.pathname === '/api/eq/band/enable') {
          const band = Number(body.band);
          if (!Number.isInteger(band) || band < 1 || band > 4) {
            return json(res, 400, { ok: false, error: 'band должен быть 1..4' });
          }
          const base = which === 'IN2' ? 0x93 : 0x91;
          const target = band <= 2 ? base : base + 1;
          const prop = band % 2 === 1 ? 0x01 : 0x06;
          frames = [{ target, prop, value: body.enabled ? 1 : 0 }];
        } else if (url.pathname === '/api/eq/switch') {
          const prop = which === 'IN2' ? 0x10 : 0x0f;
          frames = [{ target: 0x9b, prop, value: body.enabled ? 1 : 0 }];
        } else if (url.pathname === '/api/eq/type') {
          const band = Number(body.band);
          if (!Number.isInteger(band) || band < 1 || band > 4) {
            return json(res, 400, { ok: false, error: 'band должен быть 1..4' });
          }
          const typeVal = body.type ?? body.code;
          if (typeVal === undefined || typeVal === null) {
            return json(res, 400, { ok: false, error: 'нужно type' });
          }
          frames = buildEqFrames(which, band, 'type', Number(typeVal));
        }
      } catch (err) {
        return json(res, 400, { ok: false, error: String(err?.message ?? err) });
      }

      if (!frames || !frames.length) {
        return json(res, 400, { ok: false, error: 'не удалось собрать кадры' });
      }

      try {
        // ПРАВИЛЬНЫЙ ПУТЬ: запись + удержание сессии + чтение новой сессией.
        const holdMs = Number(body.holdMs) || 2500;
        const out = await transport.writeEqWithCommit(frames, { holdMs });
        // ЧЕСТНОЕ ПОДТВЕРЖДЕНИЕ.
        //
        // `readViaDump()` живёт в ТОЙ ЖЕ сессии, а EQ приходит только
        // на первый announce новой (см. `prove-announce-eq-rule`).
        // Значит после записи он вернёт кеш — то, что мы сами туда
        // положили, — и «подтвердит» запись, даже если карта её
        // потеряла. Ровно эта ошибка уже была и была исправлена;
        // здесь она вернулась через серверный путь.
        //
        // Правильный способ — `readFresh()`: закрыть сессию и открыть
        // новую. Он дороже (~7 с), но только он говорит правду.
        let after = null;
        try {
          after = await transport.readFresh?.();
        } catch {
          after = null;
        }
        const confirmed = after !== null && Number.isFinite(
          after[`${frames[0].target}:${frames[0].prop}`],
        ) && after[`${frames[0].target}:${frames[0].prop}`] === frames[0].value;

        const row = after
          ? readChannelBands(after, which).find(
            (b) => Number(b.band) === Number(body.band ?? 1),
          ) ?? null
          : null;

        broadcast({
          type: 'eq-write',
          route: url.pathname,
          input: which,
          frames: out.frames,
        });

        return json(res, 200, {
          ok: true,
          applied: confirmed ? 'confirmed' : 'unverified',
          via: 'hid',
          input: which,
          route: url.pathname,
          frames: out.frames,
          holdMs: out.holdMs,
          settleMs: out.settleMs,
          reread: after !== null,
          after: row,
          note:
            'Запись EQ требует: (1) удержания сессии ≥2 с, (2) паузы ~4 с '
            + 'после этого до закрытия сессии, (3) чтения НОВОЙ сессией. '
            + 'applied: confirmed ставится только если новая сессия вернула '
            + 'записанное значение; unverified — если перечитать не удалось.',
        });
      } catch (err) {
        return json(res, 500, {
          ok: false,
          error: String(err?.message ?? err),
        });
      }
    }

    // Переключить EQ входа — оставлено как справка для чтения.
    // Запись перехватывается блоком выше и честно отвечает applied:'unverified'.
    if (req.method === 'POST' && url.pathname === '/api/eq/switch') {
      const body = await readBody(req);
      const which = body.input === 'IN2' ? 'IN2' : 'IN1';

      // ═══ ПУТЬ ЧЕРЕЗ HID ═══
      //
      // Общий включатель EQ входа: 0x9b:0x0f для IN1, 0x9b:0x10 для IN2.
      // ВНИМАНИЕ: проверка 2026-11-13 показала, что запись НЕ принимается
      // (см. блок EQ_INPUT_WRITE_ROUTES выше). Код оставлен, чтобы было
      // видно, что именно мы пробовали.
      if (!transport.isOpen?.() && !transport.device) {
        return json(res, 503, { ok: false, error: 'устройство не открыто', hint: 'POST /api/connect' });
      }

      try {
        const prop = which === 'IN2' ? 0x10 : 0x0f;
        const snap = transport.snapshot();
        const curRaw = snapshotValue(snap, 0x9b, prop);
        const want = body.enabled === undefined
          ? (curRaw === 1 ? 0 : 1)
          : (body.enabled ? 1 : 0);

        const out = transport.writeFrames([{ target: 0x9b, prop, value: want }]);
        broadcast({ type: 'ack', op: 'eq-switch', input: which, enabled: want === 1, via: 'hid' });
        return json(res, 200, {
          ok: true,
          input: which,
          enabled: want === 1,
          before: curRaw === undefined ? null : curRaw === 1,
          changed: curRaw === undefined ? null : curRaw !== want,
          via: 'hid',
          frames: out.frames,
        });
      } catch (err) {
        return json(res, 400, { ok: false, error: String(err?.message ?? err) });
      }
    }

    // ШКАЛЫ EQ-ДИАЛОВ: измеренные таблицы и формулы (для фронта).
    if (req.method === 'GET' && url.pathname === '/api/eq/scales') {
      return json(res, 200, { ok: true, ...describeScales() });
    }

    // Прочитать типы фильтров из ОТКРЫТОГО окна EQ.
    if (req.method === 'GET' && url.pathname === '/api/eq/types') {
      try {
        // ═══ ИЗ HID ═══
        //
        // Тип фильтра каждой полосы теперь читается из тегов
        // (свойство 0x02 / 0x07), а не из открытого попапа MCC.
        // Окно не нужно.
        const which = url.searchParams.get('input') === 'IN2' ? 'IN2' : 'IN1';
        const snap = transport.snapshot();
        const bands = readChannelBands(snap, which).map((b) => ({
          band: b.band,
          code: b.type,
          type: b.typeName,
        }));
        return json(res, 200, {
          ok: true,
          via: 'hid',
          input: which,
          bands,
          types: bands.map((b) => ({ band: b.band, type: b.type })),
          filterTypes: EQ_LAYOUT.filterTypes,
          typeCodes: DEVICE_TYPE_CODE,
        });
      } catch (err) {
        return json(res, 400, { ok: false, error: String(err?.message ?? err) });
      }
    }

    // Дилы и чекбоксы полос: карта индексов для фронта (диагностика).
    //
    // Сама карта индексов имеет смысл только для UI-пути через MCC,
    // поэтому отдаём её, если MCC запущен; без него — данные из HID
    // и явный признак, что дилы недоступны.
    if (req.method === 'GET' && url.pathname === '/api/eq/dials') {
      try {
        const which = url.searchParams.get('input') === 'IN2' ? 'IN2' : 'IN1';
        const snap = transport.snapshot();
        const bands = readChannelBands(snap, which);

        // Карта дилов нужна только UI-пути. Пробуем, но не падаем:
        // без MCC её просто нет, а данные полос есть всё равно.
        let dials = null;
        let dialsError = null;
        let windowOpen = false;
        try {
          windowOpen = isEqWindowOpen();
          if (windowOpen) {
            dials = dialIndexMap(which);
          } else {
            dialsError = 'окно EQ закрыто — карта дилов недоступна (данные полос приходят из HID)';
          }
        } catch (e) {
          dialsError = String(e?.message ?? e);
        }

        return json(res, 200, {
          ok: true,
          via: 'hid',
          input: which,
          windowOpen,
          bands,
          dials,
          dialsError,
          settleMs: FILE_SETTLE_MS,
        });
      } catch (err) {
        return json(res, 400, { ok: false, error: String(err?.message ?? err) });
      }
    }

    // Открыть окно EQ (двойной клик по кнопке входа).
    if (req.method === 'POST' && url.pathname === '/api/eq/open') {
      const body = await readBody(req);
      const which = body.input === 'IN2' ? 'IN2' : 'IN1';
      try {
        const out = await openEqWindow(which);
        return json(res, out.opened ? 200 : 500, { ok: out.opened, input: which, ...out });
      } catch (err) {
        return json(res, 400, { ok: false, error: String(err?.message ?? err) });
      }
    }

    // ИЗМЕНИТЬ ПАРАМЕТР ПОЛОСЫ EQ (Gain/Freq/Q) — клавиатурой на диле.
    //
    // Тело: { input?: 'IN1'|'IN2', band: 1..4, param: 'gain'|'freq'|'q', delta: number }
    //   gain:  delta = дельта в дБ (шаг 1, округляется)
    //   freq:  delta = число шагов шкалы (f(n) = 20 * 1000^(n/100))
    //   q:     delta = число шагов нелинейной шкалы
    // Либо вместо delta можно задать value:
    //   { param:'freq', value: 1000 } — бекенд посчитает шаги по формуле.
    //
    // ТРЕБОВАНИЯ: MCC запущен, окно EQ открыто, EQ может быть выключен.
    if (req.method === 'POST' && url.pathname === '/api/eq/band') {
      const body = await readBody(req);
      const which = body.input === 'IN2' ? 'IN2' : 'IN1';
      const band = Number(body.band);
      const param = String(body.param ?? '');

      if (!Number.isInteger(band) || band < 1 || band > 4) {
        return json(res, 400, { ok: false, error: 'band должен быть 1..4' });
      }
      if (!['gain', 'freq', 'q'].includes(param)) {
        return json(res, 400, { ok: false, error: 'param должен быть gain | freq | q' });
      }

      // ═══ ПУТЬ ЧЕРЕЗ HID (основной) ═══
      //
      // Проверено 2026-11-10: все поля полос пишутся прямой записью
      // в HID, окно MCC не нужно. Раньше здесь открывалось окно EQ
      // и двигались дилы клавишами — это удалено.
      //
      // Если по какой-то причине HID-путь недоступен (устройство не
      // открыто), вернём понятную ошибку, а не 409 про окно.
      if (!transport.isOpen?.() && !transport.device) {
        return json(res, 503, {
          ok: false,
          error: 'устройство не открыто — EQ пишется через HID',
          hint: 'POST /api/connect',
        });
      }

      try {
        // Текущее значение — из кеша HID, а не из файла MCC.
        // Файл остаётся резервным источником, если тег ещё не пришёл.
        const snap = transport.snapshot();
        const curRow = readChannelBands(snap, which).find((b) => b.band === band);
        const curFromHid = curRow ? eqHumanFromRow(curRow, param) : null;
        const curWs = readEqBandsFromWorkspace(which, band);
        const cur = curFromHid ?? (curWs ? eqHumanFromRow(curWs, param) : null);

        // Режим «задать абсолютное значение»
        if (body.value !== undefined && body.value !== null) {
          const target = Number(body.value);
          if (!Number.isFinite(target)) {
            return json(res, 400, { ok: false, error: 'value должно быть числом' });
          }
          const frames = buildEqFrames(which, band, param, target);
          const out = transport.writeFrames(frames);
          broadcast({
            type: 'eq-band', input: which, band, param, target, via: 'hid', after: target,
          });
          return json(res, 200, {
            ok: true,
            input: which,
            band,
            param,
            via: 'hid',
            requested: target,
            before: cur,
            after: target,
            frames: out.frames,
          });
        }

        // Режим «сдвинуть на delta»
        const delta = Number(body.delta);
        if (!Number.isFinite(delta)) {
          return json(res, 400, { ok: false, error: 'нужно delta или value' });
        }
        if (cur === null || cur === undefined) {
          return json(res, 409, {
            ok: false,
            error: `текущее значение полосы ${band} неизвестно — задайте value вместо delta`,
            hint: `POST /api/eq/band {input:"${which}", band:${band}, param:"${param}", value:<число>}`,
          });
        }
        const target = roundEqValue(param, cur + delta);
        const frames = buildEqFrames(which, band, param, target);
        const out = transport.writeFrames(frames);
        broadcast({
          type: 'eq-band', input: which, band, param, delta, after: target, via: 'hid',
        });
        return json(res, 200, {
          ok: true,
          input: which,
          band,
          param,
          via: 'hid',
          delta,
          before: cur,
          after: target,
          frames: out.frames,
        });
      } catch (err) {
        return json(res, 400, { ok: false, error: String(err?.message ?? err) });
      }
    }

    // Включить/выключить ПОЛОСУ EQ.
    //
    // Через HID: 0x91..0x94 свойство 0x01 (полоса A) или 0x06 (полоса B).
    // Проверено 2026-11-10: 0x91:01  0 -> 1 принято, откат ОК.
    // Прежний путь (QCheckBox полосы через UIAutomation) удалён.
    if (req.method === 'POST' && url.pathname === '/api/eq/band/enable') {
      const body = await readBody(req);
      const which = body.input === 'IN2' ? 'IN2' : 'IN1';
      const band = Number(body.band);
      if (!Number.isInteger(band) || band < 1 || band > 4) {
        return json(res, 400, { ok: false, error: 'band должен быть 1..4' });
      }
      if (!transport.isOpen?.() && !transport.device) {
        return json(res, 503, { ok: false, error: 'устройство не открыто', hint: 'POST /api/connect' });
      }

      try {
        const snap = transport.snapshot();
        const row = readChannelBands(snap, which).find((b) => b.band === band);
        const curRaw = row?.enable;
        const want = body.enabled === undefined
          ? (curRaw === 1 ? 0 : 1)
          : (body.enabled ? 1 : 0);

        const frames = buildEqFrames(which, band, 'enable', want);
        const out = transport.writeFrames(frames);
        broadcast({ type: 'eq-band-enable', input: which, band, enabled: want === 1, via: 'hid' });
        return json(res, 200, {
          ok: true,
          input: which,
          band,
          enabled: want === 1,
          before: curRaw === undefined ? null : curRaw === 1,
          changed: curRaw === undefined ? null : curRaw !== want,
          via: 'hid',
          frames: out.frames,
        });
      } catch (err) {
        return json(res, 400, { ok: false, error: String(err?.message ?? err) });
      }
    }

    // СМЕНИТЬ ТИП ФИЛЬТРА полосы EQ.
    //
    // ВАЖНО: работает ТОЛЬКО реальным кликом мыши по пункту popup.
    // Проверено (eq-set-type.js): InvokePattern.Invoke() и
    // SelectionItemPattern.Select() на пунктах возвращают успех,
    // но НЕ применяют выбор к модели. Expand() при этом работает.
    if (req.method === 'POST' && url.pathname === '/api/eq/type') {
      const body = await readBody(req);
      const which = body.input === 'IN2' ? 'IN2' : 'IN1';
      const band = Number(body.band);
      const type = String(body.type ?? '');

      if (!Number.isInteger(band) || band < 1 || band > 4) {
        return json(res, 400, { ok: false, error: 'band должен быть 1..4' });
      }
      if (!EQ_LAYOUT.filterTypes.includes(type)) {
        return json(res, 400, {
          ok: false,
          error: `type должен быть один из: ${EQ_LAYOUT.filterTypes.join(', ')}`,
        });
      }

      // ═══ ПУТЬ ЧЕРЕЗ HID ═══
      //
      // Тип фильтра — числовой код в HID: свойство 0x02 (полоса A)
      // или 0x07 (полоса B). Проверено 2026-11-10: 0x91:02 1 -> 2
      // принято, откат ОК.
      //
      // Числа типов берём из EQ_LAYOUT.filterTypes — порядок массива
      // и есть код (peaking=0, lowpass=1, ...). Если окажется иначе,
      // это выяснится при первом же тесте конкретного типа.
      if (!transport.isOpen?.() && !transport.device) {
        return json(res, 503, { ok: false, error: 'устройство не открыто', hint: 'POST /api/connect' });
      }

      try {
        // Код типа берём из таблицы устройства, а НЕ из индекса массива.
        // Устройство нумерует типы с единицы: peaking=1, lowpass=2, ...
        // Индекс массива filterTypes начинается с нуля и даёт сдвиг на 1
        // (на этом уже была ошибка: peaking уходил как 0).
        const code = DEVICE_TYPE_CODE[type];
        if (code === undefined) {
          return json(res, 400, {
            ok: false,
            error: `для типа "${type}" не задан код устройства`,
            known: Object.keys(DEVICE_TYPE_CODE),
          });
        }
        const snap = transport.snapshot();
        const row = readChannelBands(snap, which).find((b) => b.band === band);
        const before = row?.type ?? null;

        if (before === code) {
          return json(res, 200, {
            ok: true, changed: false, input: which, band, type, code,
            reason: 'уже этот тип', via: 'hid',
          });
        }

        const frames = buildEqFrames(which, band, 'type', code);
        const out = transport.writeFrames(frames);
        broadcast({ type: 'eq-type', input: which, band, type, code, via: 'hid' });
        return json(res, 200, {
          ok: true,
          changed: true,
          input: which,
          band,
          requested: type,
          code,
          before,
          after: code,
          via: 'hid',
          frames: out.frames,
        });
      } catch (err) {
        return json(res, 400, { ok: false, error: String(err?.message ?? err) });
      }
    }

    // Параметры EQ — из файла workspace (единственный источник значений)
    if (req.method === 'GET' && url.pathname === '/api/eq/params') {
      // ═══ ИЗ HID ═══
      //
      // Раньше маршрут падал с 400, если не было файла MCC. Теперь
      // данные берутся из тегов, файл не нужен.
      const snap = transport.snapshot();
      const out = { ok: true, via: 'hid', layout: EQ_LAYOUT, blocks: [] };
      for (const [id, channel] of [['EQ_IN1', 'IN1'], ['EQ_IN2', 'IN2']]) {
        out.blocks.push({
          id,
          channel,
          bands: readChannelBands(snap, channel).map((b) => ({
            band: b.band,
            enable: b.enable,
            type: b.type,
            typeName: b.typeName,
            freq: b.freq,
            q: b.q,
            gain: b.gain,
          })),
        });
      }
      return json(res, 200, out);
    }

    // Имена: Load/Save preset1/2, Chat, Vocal.
    if (req.method === 'POST' && url.pathname === '/api/mcc/click') {
      const body = await readBody(req);
      if (!body.name) return json(res, 400, { ok: false, error: 'укажи name' });
      const out = clickByName(String(body.name));
      workspace.invalidate();
      broadcast({ type: 'ack', op: 'mcc-click', name: body.name });
      return json(res, 200, { ok: true, name: body.name, result: out });
    }

    // ═══ КОМПРЕССОР ═══
    // Состояние + шкалы. Значения — из файла workspace (единственный источник).
    if (req.method === 'GET' && url.pathname === '/api/compressor') {
      try {
        // ═══ ЧТЕНИЕ ЧЕРЕЗ HID ═══
        //
        // Раньше значения читались из файла workspace MCC. Теперь —
        // из кеша HID (теги 0x46), файл остаётся резервом, если
        // устройство ещё не отдало блок.
        const snap = transport.snapshot();
        const hid = readCompressorHid(snap);
        const hasHid = Object.values(hid).some((v) => v !== null && v !== undefined);

        let values = hid;
        let source = 'hid';
        if (!hasHid) {
          try {
            values = comp.readCompressorValues();
            source = 'workspace';
          } catch {
            values = hid;
            source = 'none';
          }
        }

        // Состояние окна — необязательная диагностика; без MCC её нет.
        let window = null;
        try { window = comp.compWindowState(); } catch { /* MCC не запущен */ }

        return json(res, 200, {
          ok: true,
          source,
          values: {
            switch: values.switch,
            threshold: values.threshold,
            ratio: values.ratio,
            attack: values.attack,
            release: values.release,
            gain: values.gain,
            gainAuto: values.gainAuto,
            mix: values.mix,
          },
          window,
          hid: describeCompHid(),
          scales: comp.describeCompressor(),
        });
      } catch (err) {
        return json(res, 500, { ok: false, error: String(err?.message ?? err) });
      }
    }

    // Шкалы отдельно — для валидации на фронте.
    if (req.method === 'GET' && url.pathname === '/api/compressor/scales') {
      return json(res, 200, { ok: true, ...comp.describeCompressor() });
    }

    // Открыть окно COMP (кнопка MORE).
    if (req.method === 'POST' && url.pathname === '/api/compressor/open') {
      try {
        const r = comp.openCompWindow();
        return json(res, 200, { ok: true, result: r, window: comp.compWindowState() });
      } catch (err) {
        return json(res, 400, { ok: false, error: String(err?.message ?? err) });
      }
    }

    // Закрыть окно COMP.
    if (req.method === 'POST' && url.pathname === '/api/compressor/close') {
      try {
        const r = comp.closeCompWindow();
        return json(res, 200, { ok: true, result: r });
      } catch (err) {
        return json(res, 400, { ok: false, error: String(err?.message ?? err) });
      }
    }

    // Установить параметр: {param, value} или {param, delta}
    if (req.method === 'POST' && url.pathname === '/api/compressor/param') {
      const body = await readBody(req);
      if (!body.param) return json(res, 400, { ok: false, error: 'укажи param' });

      // ═══ СОВМЕСТИМОСТЬ ИМЁН ═══
      //
      // API исторически принимал имена в стиле MCC: Threshold, Ratio,
      // Attack, Release, Gain, Mix (с большой буквы). HID-модуль
      // использует строчные. Принимаем оба варианта — иначе старые
      // клиенты и тесты сломаются на ровном месте.
      const CANON = {
        Threshold: 'threshold', threshold: 'threshold',
        Ratio: 'ratio', ratio: 'ratio',
        Attack: 'attack', attack: 'attack',
        Release: 'release', release: 'release',
        Gain: 'gain', gain: 'gain',
        GainAuto: 'gainAuto', gainAuto: 'gainAuto',
        Mix: 'mix', mix: 'mix',
        Switch: 'switch', switch: 'switch',
      };
      const param = CANON[body.param];
      if (!param) {
        return json(res, 400, {
          ok: false,
          error: `неизвестный параметр: ${body.param}`,
          known: Object.keys(comp.COMP_PARAMS_ORDER),
          alsoAccepted: Object.keys(CANON).filter((k) => /^[a-z]/.test(k)),
        });
      }

      // ═══ ПУТЬ ЧЕРЕЗ HID ═══
      //
      // Проверено 2026-11-10: Threshold, Ratio, Attack, Release, Mix
      // пишутся прямой записью в 0x46, окно MCC не нужно. Чтение
      // проверялось в новой сессии, откат ОК.
      // Прежний путь (дилы окна компрессора через UIAutomation) удалён.
      if (!transport.isOpen?.() && !transport.device) {
        return json(res, 503, { ok: false, error: 'устройство не открыто', hint: 'POST /api/connect' });
      }

      try {
        const snap = transport.snapshot();
        const cur = readCompressorHid(snap)[param];

        let target;
        if (body.delta !== undefined) {
          const d = Number(body.delta);
          if (!Number.isFinite(d) || d === 0) {
            return json(res, 400, { ok: false, error: 'delta должно быть числом ≠ 0' });
          }
          if (cur === null || cur === undefined) {
            return json(res, 409, {
              ok: false,
              error: `текущее значение ${param} неизвестно — задайте value вместо delta`,
              hint: `POST /api/compressor/param {param:"${param}", value:<число>}`,
            });
          }
          target = cur + d;
        } else if (body.value !== undefined) {
          target = Number(body.value);
        } else {
          return json(res, 400, { ok: false, error: 'нужен value или delta' });
        }

        const frames = buildCompFrames(param, target);
        const out = transport.writeFrames(frames);
        broadcast({
          type: 'ack', op: 'compressor', param, before: cur, after: target, via: 'hid',
        });
        return json(res, 200, {
          ok: true,
          param,
          before: cur,
          after: target,
          changed: cur !== target,
          via: 'hid',
          frames: out.frames,
        });
      } catch (err) {
        return json(res, 400, { ok: false, error: String(err?.message ?? err) });
      }
    }

    // Переключатели: {id: 'switch'|'gainAuto', value: bool}
    if (req.method === 'POST' && url.pathname === '/api/compressor/switch') {
      const body = await readBody(req);
      const id = String(body.id ?? 'switch');
      if (!['switch', 'gainAuto'].includes(id)) {
        return json(res, 400, { ok: false, error: 'id должен быть switch или gainAuto' });
      }
      if (body.value === undefined) {
        return json(res, 400, { ok: false, error: 'укажи value (true/false)' });
      }
      if (!transport.isOpen?.() && !transport.device) {
        return json(res, 503, { ok: false, error: 'устройство не открыто', hint: 'POST /api/connect' });
      }
      try {
        const want = body.value ? 1 : 0;
        const snap = transport.snapshot();
        const curRaw = readCompressorHid(snap)[id];
        const frames = buildCompFrames(id, want);
        const out = transport.writeFrames(frames);
        broadcast({ type: 'ack', op: 'compressor-switch', id, value: Boolean(body.value), via: 'hid' });
        return json(res, 200, {
          ok: true,
          id,
          before: curRaw === null || curRaw === undefined ? null : Boolean(curRaw),
          value: Boolean(body.value),
          changed: curRaw === null || curRaw === undefined ? null : Boolean(curRaw) !== Boolean(body.value),
          via: 'hid',
          frames: out.frames,
        });
      } catch (err) {
        return json(res, 400, { ok: false, error: String(err?.message ?? err) });
      }
    }

    if (req.method === 'POST' && url.pathname === '/api/settings/toggle') {
      const body = await readBody(req);
      const out = settings.setToggle(body.id, body.value);
      broadcast({ type: 'ack', op: 'setting', ...out });
      return json(res, 200, { ok: true, ...out });
    }

    if (req.method === 'POST' && url.pathname === '/api/settings/enum') {
      const body = await readBody(req);
      const out = settings.setEnum(body.id, Number(body.value));
      broadcast({ type: 'ack', op: 'setting', ...out });
      return json(res, 200, { ok: true, ...out });
    }

    if (req.method === 'POST' && url.pathname === '/api/settings/command') {
      const body = await readBody(req);
      const out = settings.runCommand(body.id, { confirm: body.confirm === true });
      broadcast({ type: 'ack', op: 'command', ...out });
      return json(res, 200, { ok: true, ...out });
    }

    if (req.method === 'POST' && url.pathname === '/api/volume') {
      const body = await readBody(req);
      const out = controls.setVolume(body.id, Number(body.value));
      // Устройство не присылает эхо — событие создаём сами (NOTES §56).
      broadcast({ type: 'event', kind: 'volume', id: out.id, value: out.value, db: out.db });
      broadcast({ type: 'ack', op: 'volume', ...out });
      return json(res, 200, { ok: true, ...out });
    }

    if (req.method === 'POST' && url.pathname === '/api/selector') {
      const body = await readBody(req);
      const out = controls.setSelector(body.id, Number(body.index));
      if (!out.noop) {
        broadcast({
          type: 'event', kind: 'selector', id: out.id,
          value: out.value, label: out.label, index: out.index,
        });
      }
      broadcast({ type: 'ack', op: 'selector', ...out });
      return json(res, 200, { ok: true, ...out });
    }

    if (req.method === 'POST' && url.pathname === '/api/connect') {
      if (!transport.device) await transport.open();
      return json(res, 200, { ok: true, connected: true });
    }

    if (req.method === 'POST' && url.pathname === '/api/disconnect') {
      // final: true — человек явно отключил, не пытаемся переподключаться.
      transport.close({ final: true });
      return json(res, 200, { ok: true, connected: false, autoReconnect: false });
    }

    // ═══ СТАТИКА: ВЕБ-КЛИЕНТ ═══
    //
    // Отдаём `web/` и `src/` — клиент импортирует те же модули
    // протокола, что и бекенд (они портируемы, см. transport-core.js).
    // Это позволяет странице работать ДВУМЯ путями:
    //   1) через WebHID напрямую (без сервера и без MCC);
    //   2) через этот сервер как через localhost-агент.
    if (req.method === 'GET' || req.method === 'HEAD') {
      const served = serveStatic(url.pathname, res);
      if (served) return;
    }

    json(res, 404, { ok: false, error: 'not found' });
  } catch (err) {
    json(res, 400, { ok: false, error: String(err?.message ?? err) });
  }
});

// ---- WebSocket ----
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  clients.add(ws);
  log.info(`ws клиент подключился (всего ${clients.size})`);

  ws.send(
    JSON.stringify({
      type: 'hello',
      connected: Boolean(transport.device),
      controls: controls.describe(),
      eqMixer: describeEqMixer(),
      // Режим сразу — фронт должен знать, что доступно, до первого запроса.
      mode: (() => {
        try {
          const w = workspace.describe();
          return describeMode(w.available ? w : null);
        } catch {
          return null;
        }
      })(),
      protocol: {
        frameLen: 15,
        reportLen: 16,
        keepaliveMs: 2000,
        crc: 'CRC-16/MODBUS',
        sessionHandshake: '0x11:0x01 = 1',
        handshakeRequired: true,
      },
    }),
  );

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    try {
      if (msg.type === 'setVolume') {
        const out = controls.setVolume(msg.id, Number(msg.value));
        // Устройство НЕ присылает эхо своих же значений (проверено,
        // research/NOTES.md §56) — поэтому событие создаём сами,
        // иначе другие клиенты не узнают об изменении.
        broadcast({ type: 'event', kind: 'volume', id: out.id, value: out.value, db: out.db });
        broadcast({ type: 'ack', op: 'volume', ...out });
      } else if (msg.type === 'setSelector') {
        const out = controls.setSelector(msg.id, Number(msg.index));
        // Селекторы тоже не эхоятся устройством (NOTES §56).
        if (!out.noop) {
          broadcast({
            type: 'event', kind: 'selector', id: out.id,
            value: out.value, label: out.label, index: out.index,
          });
        }
        broadcast({ type: 'ack', op: 'selector', ...out });
      } else if (msg.type === 'setSetting') {
        // настройка устройства: enum (если msg.enum) или toggle
        const out = msg.enum
          ? settings.setEnum(msg.id, Number(msg.value))
          : settings.setToggle(msg.id, msg.value);
        broadcast({ type: 'ack', op: 'setting', ...out });
      } else if (msg.type === 'runCommand') {
        const out = settings.runCommand(msg.id, { confirm: msg.confirm === true });
        broadcast({ type: 'ack', op: 'command', ...out });
      } else if (msg.type === 'setReverb') {
        const typeName = msg.reverbType ?? msg.value;
        // Через HID: тот же путь, что POST /api/reverb.
        try {
          const code = typeCode(typeName);
          const out = transport.writeFrames(buildReverbFrames('type', code));
          broadcast({
            type: 'ack', op: 'reverb', type: REVERB_TYPES[code], code, via: 'hid', frames: out.frames,
          });
        } catch (err) {
          ws.send(JSON.stringify({ type: 'error', op: 'reverb', error: String(err?.message ?? err) }));
        }
      } else if (msg.type === 'getState') {
        // Полный контекст: контролы, настройки, workspace, режим.
        // Фронту это нужно при подключении, чтобы сразу отрисовать всё.
        const wsSnap = workspace.describe();
        ws.send(
          JSON.stringify({
            type: 'state',
            connected: Boolean(transport.device),
            controls: controls.describe(),
            settings: settings.describe(),
            workspace: wsSnap.available ? wsSnap : null,
            mode: describeMode(wsSnap.available ? wsSnap : null),
            counts: {
              volumes: controls.describe().volumes.length,
              selectors: controls.describe().selectors.length,
              mixerChannels: wsSnap.available ? wsSnap.mixer.length : 0,
              eqBlocks: wsSnap.available ? wsSnap.eq.length : 0,
            },
          }),
        );
      }
    } catch (err) {
      ws.send(
        JSON.stringify({ type: 'error', message: String(err?.message ?? err) }),
      );
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    log.info(`ws клиент отключился (осталось ${clients.size})`);
  });
});

// ---- старт ----
server.listen(PORT, HOST, () => {
  log.info(`HTTP  http://${HOST}:${PORT}`);
  log.info(`WS    ws://${HOST}:${PORT}/ws`);

  // ═══ АВТОЗАХВАТ УСТРОЙСТВА: ТОЛЬКО ПО ФЛАГУ ═══
  //
  // Раньше сервер СРАЗУ открывал карту при старте. Это ломало
  // веб-клиент: браузер с WebHID и сервер с node-hid оказывались
  // двумя писателями на одном устройстве, со своими keepalive,
  // announce и кешами — и перезаписывали настройки друг друга.
  //
  // Теперь автозахват только при M62_AUTOCONNECT=1 (режим агента,
  // когда страница работает через HTTP, а не через WebHID).
  if (process.env.M62_AUTOCONNECT === '1') {
    const found = M62Transport.find();
    if (found) {
      log.info(`устройство найдено: iface=${found.interface}, открываю (M62_AUTOCONNECT=1)…`);
      transport.open().catch((err) => log.error('не удалось открыть:', err.message));
    } else {
      log.warn('M62 не найден — подключите позже через POST /api/connect');
    }
  } else {
    log.info('автозахват выключен — устройство откроется по POST /api/connect');
    log.info('(включить автозахват: M62_AUTOCONNECT=1)');
  }
});

function shutdown() {
  log.info('остановка…');
  transport.close();
  wss.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);





