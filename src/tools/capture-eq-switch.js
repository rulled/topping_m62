/**
 * ЧТО MCC ШЛЁТ ПРИ ПЕРЕКЛЮЧЕНИИ EQ?
 *
 * ═══ ПОЧЕМУ ═══
 *
 * Доказано: запись в 0x9b:0x0f (мин. «включатель EQ») НЕ принимается
 * устройством. Значит `/api/eq/switch` не работает, хотя отвечает
 * ok:true. Нужен настоящий адрес/механизм.
 *
 * Лучший способ узнать — снять USBPcap, пока MCC переключает EQ
 * своей кнопкой PushButtonEQ (это QCheckBox с TogglePattern).
 *
 * ═══ ЧТО ДЕЛАЕТ ═══
 *
 * 1. Убивает зависшие USBPcap (иначе захват молча пишет 0 байт).
 * 2. Закрывает MCC, запускает захват.
 * 3. Запускает MCC, ждёт загрузки.
 * 4. Переключает PushButtonEQ (IN1) через TogglePattern.
 * 5. Ждёт, останавливает захват.
 * 6. Разбирает: какие кадры ушли в момент переключения.
 *
 * ═══ БЕЗОПАСНОСТЬ ═══
 *
 * Только чтение состояния + переключение EQ. Наушники глушатся
 * заранее длинным снимком. EQ сам по себе звук не делает громче.
 *
 * Запуск: node src/tools/capture-eq-switch.js
 */

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

import HID from 'node-hid';

import {
  buildFrame,
  withReportId,
  parseReport,
  isIdle,
  PP_HANDSHAKE,
  PP_SUBSCRIBE,
  PP_ANNOUNCE,
} from '../protocol.js';

import { ps, PRELUDE } from './uia.js';
import { killCaptureProcesses } from '../elevate.js';

const VID = 0x152a;
const PID = 0x875c;
const MCC_EXE = 'C:\\Program Files\\TOPPING Pro\\M Control Center\\M Control Center.exe';
const USBCAP = 'C:\\Program Files\\USBPcap\\USBPcapCMD.exe';
const OUT_DIR = 'research';
const OUT = join(OUT_DIR, 'eq-switch.pcap');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hex2 = (n) => n.toString(16).padStart(2, '0');

function findDev() {
  return HID.devices()
    .filter((d) => d.vendorId === VID && d.productId === PID)
    .find((d) => d.interface === 4);
}

async function snapshot(ms = 10000) {
  const dev = findDev();
  const h = new HID.HID(dev.path);
  const send = (tt, pp, v) => h.write([...withReportId(buildFrame(tt, pp, v, true))]);
  send(0x11, PP_HANDSHAKE, 1);
  await sleep(400);
  send(0x11, PP_SUBSCRIBE, 1);
  await sleep(300);
  send(0x11, PP_ANNOUNCE, 1);
  const out = new Map();
  const t0 = Date.now();
  let lk = Date.now();
  while (Date.now() - t0 < ms) {
    for (let j = 0; j < 128; j++) {
      let buf;
      try {
        buf = h.readTimeout(1);
      } catch {
        break;
      }
      if (!buf || !buf.length) break;
      if (isIdle(buf)) continue;
      const f = parseReport(buf);
      if (!f) continue;
      out.set(`${hex2(f.target)}:${hex2(f.prop)}`, f.value);
    }
    if (Date.now() - lk >= 2000) {
      send(0x11, PP_SUBSCRIBE, 1);
      lk = Date.now();
    }
    await sleep(8);
  }
  try {
    h.close();
  } catch {
    /* ok */
  }
  return out;
}

async function write(frames) {
  const dev = findDev();
  const h = new HID.HID(dev.path);
  const send = (tt, pp, v) => h.write([...withReportId(buildFrame(tt, pp, v, true))]);
  send(0x11, PP_HANDSHAKE, 1);
  await sleep(400);
  send(0x11, PP_SUBSCRIBE, 1);
  await sleep(250);
  for (const [tt, pp, v] of frames) {
    send(tt, pp, v);
    await sleep(400);
  }
  await sleep(800);
  try {
    h.close();
  } catch {
    /* ok */
  }
}

/** Разбор pcap: возвращает список (ms, tt, pp, value) кадров хоста. */
function decodePcap(path) {
  const buf = readFileSync(path);
  const little = buf[0] === 0xd4;
  const u32 = (o) => (little ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
  let off = 24;
  const frames = [];
  let baseTs = null;
  while (off + 16 <= buf.length) {
    const tsSec = u32(off);
    const tsUsec = u32(off + 4);
    const incl = u32(off + 8);
    off += 16;
    const data = buf.subarray(off, off + incl);
    off += incl;
    if (data.length < 27) continue;
    const hlen = data.readUInt16LE(0);
    if (hlen < 27 || hlen > data.length) continue;
    const ep = data[21];
    const dlen = data.readUInt32LE(23);
    const payload = data.subarray(hlen, hlen + dlen);
    if (ep & 0x80) continue; // только хост -> устройство
    const ts = tsSec * 1000 + Math.floor(tsUsec / 1000);
    if (baseTs === null) baseTs = ts;
    let s = 0;
    while (true) {
      const p = payload.indexOf(Buffer.from([0x22, 0x33]), s);
      if (p < 0) break;
      const c = payload.subarray(p, p + 15);
      if (c.length === 15 && c[13] === 0x66 && c[14] === 0x77) {
        frames.push({
          ms: ts - baseTs,
          tt: c[5],
          pp: c[6],
          value: c.readInt32BE(7),
        });
      }
      s = p + 1;
    }
  }
  return frames;
}

async function main() {
  console.log('='.repeat(64));
  console.log('ЧТО MCC ШЛЁТ ПРИ ПЕРЕКЛЮЧЕНИИ EQ');
  console.log('='.repeat(64));

  // ─── 1. безопасность: глушим наушники ───
  const s0 = await snapshot();
  const jack = s0.get('64:06');
  const mute0 = s0.get('64:04');
  console.log(`\nнаушники: jack=${jack} mute=${mute0}`);
  let restoreMute = false;
  if (jack === 1 && mute0 !== 1) {
    await write([[0x64, 0x04, 1]]);
    const chk = await snapshot();
    if (chk.get('64:04') !== 1) {
      console.log('не заглушилось — ОСТАНОВ');
      process.exit(1);
    }
    restoreMute = true;
    console.log('  заглушено и подтверждено');
  }

  // ─── 2. чистим захваты ───
  const k = killCaptureProcesses();
  console.log(`\nUSBPcap: убито ${k.killed}, осталось ${k.remaining}`);

  // ─── 3. закрываем MCC, стартуем захват ───
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-Command', 'Stop-Process -Name "M Control Center" -Force -ErrorAction SilentlyContinue']);
  } catch {
    /* ok */
  }
  await sleep(3000);

  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  if (existsSync(OUT)) unlinkSync(OUT);

  console.log('старт захвата…');
  const cap = spawn(USBCAP, ['-d', '\\\\.\\USBPcap1', '-o', OUT, '-A'], {
    stdio: ['pipe', 'ignore', 'ignore'],
  });
  await sleep(4000);
  if (cap.exitCode !== null) {
    console.log('захват не запустился');
    process.exit(1);
  }

  // ─── 4. запускаем MCC ───
  console.log('запуск MCC…');
  spawn(MCC_EXE, [], { detached: true, stdio: 'ignore' }).unref();
  await sleep(16000);

  // ─── 5. переключаем EQ ───
  console.log('ищу PushButtonEQ…');
  const find = () => ps(PRELUDE + String.raw`
$root = Get-MccRoot
$all = Get-MccAll $root
for ($i=0; $i -lt $all.Count; $i++) {
  $e = $all.Item($i); $aid=''; try { $aid = $e.Current.AutomationId } catch {}
  if ($aid -match 'PushButtonEQ$') {
    $r = $e.Current.BoundingRectangle
    $s=''; try { $p=$null; if ($e.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern,[ref]$p)) { $s = ([System.Windows.Automation.TogglePattern]$p).Current.ToggleState } } catch {}
    Write-Output ($i.ToString() + "|" + [int]$r.Width + "x" + [int]$r.Height + "|" + $s + "|" + $aid.Substring([Math]::Max(0,$aid.Length-30)))
  }
}
`).trim();

  const found = find();
  console.log(found || '(PushButtonEQ не найден)');
  if (!found) {
    cap.stdin.write('\n');
    await sleep(2500);
    try {
      cap.kill();
    } catch {
      /* ok */
    }
    console.log('ОСТАНОВ: кнопка не найдена');
    return;
  }

  const idx = Number(found.split('\n')[0].split('|')[0]);
  const toggle = () => ps(PRELUDE + String.raw`
$root = Get-MccRoot; $all = Get-MccAll $root; $e = $all.Item(${idx}); $p=$null
if ($e.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern,[ref]$p)) { ([System.Windows.Automation.TogglePattern]$p).Toggle(); Write-Output "TOGGLED" }
else { Write-Output "NOPATTERN" }
`).trim();

  console.log(`\nнажимаю EQ (i=${idx})…`);
  console.log('  ' + toggle());
  await sleep(4000);
  console.log('нажимаю ещё раз (вернуть)…');
  console.log('  ' + toggle());
  await sleep(4000);

  // ─── 6. стоп ───
  console.log('\nостанавливаю захват…');
  try {
    cap.stdin.write('\n');
  } catch {
    /* ok */
  }
  await sleep(3000);
  try {
    cap.kill();
  } catch {
    /* ok */
  }
  await sleep(1500);

  if (restoreMute) await write([[0x64, 0x04, mute0 ?? 0]]);

  if (!existsSync(OUT)) {
    console.log('файла захвата нет');
    return;
  }
  const size = statSync(OUT).size;
  console.log(`захвачено: ${size} байт`);

  // ─── 7. разбор ───
  console.log('\n' + '='.repeat(64));
  console.log('КАДРЫ 0x9b / EQ-СЕМЕЙСТВ');
  console.log('='.repeat(64));
  const frames = decodePcap(OUT);
  console.log(`всего кадров хоста: ${frames.length}`);

  const eqish = frames.filter(
    (f) => f.tt === 0x9b || f.tt === 0x91 || f.tt === 0x92 || f.tt === 0x93 || f.tt === 0x94 || f.tt === 0x11,
  );
  for (const f of eqish) {
    console.log(`  ${String(f.ms).padStart(7)} ms  0x${hex2(f.tt)}:0x${hex2(f.pp)} = ${f.value}`);
  }

  const byTt = {};
  for (const f of frames) byTt[hex2(f.tt)] = (byTt[hex2(f.tt)] || 0) + 1;
  console.log('\nвсе семейства:');
  for (const tt of Object.keys(byTt).sort()) console.log(`  0x${tt}: ${byTt[tt]}`);

  console.log('\n' + '='.repeat(64));
  console.log('ЧТО ИСКАТЬ');
  console.log('='.repeat(64));
  console.log('  Кадр, который появился РОВНО в момент переключения EQ');
  console.log('  (около времени двух кликов) — это и есть настоящий');
  console.log('  переключатель. 0x9b:0x0f там быть НЕ должно, иначе');
  console.log('  устройство бы его приняло.');
}

main().catch((e) => {
  console.error('ошибка:', e.message);
  process.exit(1);
});

