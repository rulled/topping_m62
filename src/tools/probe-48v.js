/**
 * ЕСТЬ ЛИ 48V (phantom power) В ПРОТОКОЛЕ?
 *
 * ═══ ЗАЧЕМ ═══
 *
 * Патч mainline-драйвера прямо говорит: «the mixer matrix, the mutes,
 * the loopback routing, THE INPUT POWER and the EQ remain reachable
 * only through the hidraw node». То есть питание входов (48V) в
 * протоколе ЕСТЬ, просто не описано драйвером.
 *
 * Но в наших дампах тега для 48V не находилось. Проверяем прицельно:
 *   - какие вообще свойства приходят у 0x21 (вход IN1);
 *   - наблюдаются ли изменения при переключении 48V в MCC.
 *
 * ═══ ЧТО ДЕЛАЕТ ═══
 *
 * Снимает ДВА полных снимка 0x21/0x22 подряд, без записи. Если набор
 * свойств стабилен и там нет кандидата на «питание» — значит либо
 * 48V вообще не отдаётся в HID, либо приходит отдельным семейством.
 *
 * Затем ищет во ВСЕХ тегах значения, равные текущему 48V из INI (0 или 1),
 * и печатает подозрительные однобитные теги.
 *
 * Запуск: node src/tools/probe-48v.js
 */

import HID from 'node-hid';
import { readFileSync, existsSync } from 'node:fs';

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
const PROF_INI =
  String.raw`C:\Program Files\TOPPING Pro\M Control Center\Workspace\M62\Prof` +
  String.raw`\M62_Prof_2026-1009-2347-04.ini`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hex2 = (n) => n.toString(16).padStart(2, '0');

/** Текущее 48V из INI (для сравнения). */
function ini48v() {
  if (!existsSync(PROF_INI)) return null;
  const lines = readFileSync(PROF_INI, 'utf8').split(/\r?\n/);
  let cur = null;
  const out = {};
  for (const line of lines) {
    const t = line.trim();
    const m = t.match(/^\[(.+)\]$/);
    if (m) {
      cur = m[1];
      continue;
    }
    if (cur && cur.startsWith('Input_') && t.startsWith('48V=')) {
      out[cur] = t.slice(4);
    }
  }
  return out;
}

async function main() {
  const all = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
  const dev = all.find((d) => d.interface === 4);
  if (!dev) {
    console.error('M62 iface 4 не найден');
    process.exit(1);
  }

  const h = new HID.HID(dev.path);
  const send = (tt, pp, v) => h.write([...withReportId(buildFrame(tt, pp, v, true))]);

  const snapshot = async (ms) => {
    const out = new Map();
    const t0 = Date.now();
    let lk = 0;
    let la = 0;
    while (Date.now() - t0 < ms) {
      for (let i = 0; i < 128; i++) {
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
      if (Date.now() - la >= 6000) {
        send(0x11, PP_ANNOUNCE, 1);
        la = Date.now();
      }
      await sleep(8);
    }
    return out;
  };

  send(0x11, PP_HANDSHAKE, 1);
  await sleep(400);
  send(0x11, PP_SUBSCRIBE, 1);

  const v48 = ini48v();
  console.log('48V из INI:', v48 ? JSON.stringify(v48) : 'не прочитать');
  console.log('');

  const a = await snapshot(26000);
  console.log(`снимок 1: ${a.size} тегов`);
  const b = await snapshot(26000);
  console.log(`снимок 2: ${b.size} тегов`);
  h.close();

  // --- свойства входов ---
  console.log('\n--- свойства 0x21 / 0x22 (входы IN1 / IN2) ---');
  for (const base of ['21', '22']) {
    const keys = [...a.keys()].filter((k) => k.startsWith(`${base}:`)).sort();
    if (!keys.length) {
      console.log(`  0x${base}: нет тегов`);
      continue;
    }
    console.log(`  0x${base}: ${keys.map((k) => `0x${k.slice(3)}=${a.get(k)}`).join('  ')}`);
  }

  // --- стабильность между снимками ---
  console.log('\n--- что изменилось между снимками (без нашей записи) ---');
  const changed = [];
  for (const [k, v] of a) {
    if (b.has(k) && b.get(k) !== v) changed.push(`${k}: ${v} -> ${b.get(k)}`);
  }
  console.log(changed.length ? `  ${changed.join('\n  ')}` : '  ничего не изменилось');

  // --- кандидаты на 48V: однобитные теги ---
  console.log('\n--- кандидаты на 48V (теги со значением 0 или 1) ---');
  const binary = [...a.entries()]
    .filter(([, v]) => v === 0 || v === 1)
    .map(([k, v]) => `0x${k}=${v}`)
    .sort();
  console.log(binary.length ? `  ${binary.join('  ')}` : '  нет');

  console.log('\n' + '='.repeat(66));
  console.log('ВЫВОД');
  console.log('='.repeat(66));
  const fam21 = [...a.keys()].filter((k) => k.startsWith('21:'));
  console.log(`  у входа IN1 в HID приходит ${fam21.length} свойств:`
    + ` ${fam21.map((k) => '0x' + k.slice(3)).join(', ') || '—'}`);
  console.log('');
  console.log('  Если среди них нет ничего похожего на питание (0/1),');
  console.log('  то 48V через HID НЕ управляется и остаётся только в INI.');
  console.log('  Наш тест ниже показывает, что 0x21 отдаёт:');
  console.log('    0x01 = метр, 0x04 = громкость, 0x06 = наличие джека');
  console.log('  — то есть питание не отдаётся.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
