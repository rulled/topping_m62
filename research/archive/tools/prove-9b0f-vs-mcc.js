/**
 * РЕШАЮЩИЙ ТЕСТ: меняется ли 0x9b:0x0f, когда EQ переключают В MCC?
 *
 * ═══ ПРОТИВОРЕЧИЕ В ДОКУМЕНТАЦИИ ═══
 *
 *   NOTES §87  (2026-11-07): «через HID запись Switch не работает
 *              (проверены 4 тега 0x9b); включение — только кликом в UI»
 *   NOTES §135 (2026-11-10): «Общий включатель EQ: 0x9b:0f 0 -> 1 принято»
 *   сегодня    (2026-11-13): пишу 0x9b:0f=1 -> читаю 0 (НЕ принято)
 *
 * Захват eq-switch.pcap: при нажатии кнопки EQ MCC НЕ отправил ни
 * одного кадра 0x9b и ни одного кадра 0x91..0x94.
 *
 * ═══ ЧТО ЭТОТ ТЕСТ РЕШАЕТ ═══
 *
 * Включаем EQ кнопкой в самом MCC (заведомо рабочий путь) и смотрим,
 * что при этом приходит в 0x9b:0f.
 *
 *   меняется на 1  -> 0x9b:0f РАБОТАЕТ как отражение, но запись
 *                     в него не принимается (односторонний тег)
 *   не меняется    -> 0x9b:0f вообще не связан с включением EQ
 *
 * Дополнительно печатаю ToggleState кнопки, чтобы убедиться, что
 * UI реально переключился.
 *
 * Запуск: node src/tools/prove-9b0f-vs-mcc.js
 */

import HID from 'node-hid';
import { ps, PRELUDE } from './uia.js';

import {
  buildFrame,
  withReportId,
  parseReport,
  isIdle,
  PP_HANDSHAKE,
  PP_SUBSCRIBE,
  PP_ANNOUNCE,
} from '../protocol.js';

const VID = 0x152a;
const PID = 0x875c;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hex2 = (n) => n.toString(16).padStart(2, '0');

function findDev() {
  return HID.devices()
    .filter((d) => d.vendorId === VID && d.productId === PID)
    .find((d) => d.interface === 4);
}

/** Чтение в НОВОЙ сессии — без нашего кеша. */
async function truth(ms = 9000) {
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

/** Состояние кнопки EQ в UI MCC. */
function eqButtonState() {
  const raw = ps(PRELUDE + String.raw`
$root = Get-MccRoot
$all = Get-MccAll $root
$out = @()
for ($i=0; $i -lt $all.Count; $i++) {
  $e = $all.Item($i); $aid=''; try { $aid = $e.Current.AutomationId } catch {}
  if ($aid -match 'PushButtonEQ$') {
    $st = 'NOPATTERN'
    try { $p=$null; if ($e.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern,[ref]$p)) { $st = ([System.Windows.Automation.TogglePattern]$p).Current.ToggleState.ToString() } } catch {}
    $which = 'IN1'; if ($aid -match 'Input_IN2') { $which = 'IN2' }
    $out += ($which + "|" + $i + "|" + $st)
  }
}
Write-Output ($out -join "//")
`).trim();
  return raw.split('//').filter(Boolean).join('\n');
}

function toggleEq(which) {
  const raw = ps(PRELUDE + String.raw`
$root = Get-MccRoot
$all = Get-MccAll $root
for ($i=0; $i -lt $all.Count; $i++) {
  $e = $all.Item($i); $aid=''; try { $aid = $e.Current.AutomationId } catch {}
  if ($aid -match 'PushButtonEQ$') {
    $w = 'IN1'; if ($aid -match 'Input_IN2') { $w = 'IN2' }
    if ($w -eq '${which}') {
      $p=$null
      if ($e.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern,[ref]$p)) {
        ([System.Windows.Automation.TogglePattern]$p).Toggle()
        Start-Sleep -Milliseconds 300
        Write-Output ("TOGGLED " + $w + " -> " + ([System.Windows.Automation.TogglePattern]$p).Current.ToggleState.ToString())
        return
      }
      Write-Output "NOPATTERN"
      return
    }
  }
}
Write-Output "NOTFOUND"
`).trim();
  return raw;
}

async function main() {
  console.log('='.repeat(66));
  console.log('МЕНЯЕТСЯ ЛИ 0x9b:0x0f, КОГДА EQ ПЕРЕКЛЮЧАЮТ В MCC?');
  console.log('='.repeat(66));

  const btn0 = eqButtonState();
  console.log('\nкнопки EQ в UI MCC:');
  console.log(btn0 || '(не найдены)');

  const t0 = await truth();
  console.log(`\nустройство ДО: 0x9b:0f = ${t0.get('9b:0f')}   0x9b:10 = ${t0.get('9b:10')}`);

  console.log('\nнажимаю EQ IN1 в MCC…');
  console.log('  ' + toggleEq('IN1'));
  await sleep(3500);

  const btn1 = eqButtonState();
  console.log('  кнопки после:');
  console.log('  ' + (btn1 || '(нет)').split('\n').join('\n  '));

  const t1 = await truth();
  console.log(`\nустройство ПОСЛЕ: 0x9b:0f = ${t1.get('9b:0f')}   0x9b:10 = ${t1.get('9b:10')}`);

  const changed = t1.get('9b:0f') !== t0.get('9b:0f');
  console.log(`\n  => 0x9b:0f ${changed ? 'ИЗМЕНИЛСЯ' : 'НЕ ИЗМЕНИЛСЯ'}`);

  console.log('\nвозвращаю кнопку…');
  console.log('  ' + toggleEq('IN1'));
  await sleep(2500);

  const t2 = await truth();
  console.log(`\nустройство ПОСЛЕ возврата: 0x9b:0f = ${t2.get('9b:0f')}`);

  console.log('\n' + '='.repeat(66));
  console.log('ВЕРДИКТ');
  console.log('='.repeat(66));
  if (changed) {
    console.log('  0x9b:0f ОТРАЖАЕТ состояние EQ, но запись в него не принимается.');
    console.log('  Значит это односторонний тег: читать можно, писать нельзя.');
    console.log('  Включение EQ через HID пока не найдено — нужен другой адрес.');
  } else {
    console.log('  0x9b:0f НЕ связан с включением EQ (не меняется даже при');
    console.log('  переключении в MCC). Значит прежняя гипотеза ошибочна.');
  }
}

main().catch((e) => {
  console.error('ошибка:', e.message);
  process.exit(1);
});
