/**
 * СЕАНС СЪЁМА ДАННЫХ.
 *
 * Ты крутишь ручки в M Control Center, скрипт молча слушает HID и пишет лог.
 * Он НИЧЕГО не отправляет в устройство: ни подписки, ни keepalive.
 * Подписку держит сам M Control Center.
 *
 * Запуск:
 *   node src/tools/session.js --seconds 120 --label "EQ gain IN1"
 *
 * В конце печатает:
 *   - какие TT/PP менялись (это и есть след твоих действий)
 *   - какие из них НОВЫЕ (не встречались в прошлых сеансах)
 *
 * Разметка по шагам: нажми Enter в консоли — поставится метка времени,
 * к которой можно привязать «что я сейчас сделал».
 */
import HID from 'node-hid';
import { createInterface } from 'node:readline';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const VID = 0x152a;
const PID = 0x875c;
const VENDOR_INTERFACE = 4;

const args = process.argv.slice(2);
function arg(name, def) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
}
const seconds = Number(arg('seconds', 120));
const label = arg('label', 'без метки');
const outFile = arg('out', `research/sessions/${Date.now()}.jsonl`);
const baseFile = 'research/known-tags.json';

// --- эталон известных тегов ---
let known = new Set();
if (existsSync(baseFile)) {
  const j = JSON.parse(readFileSync(baseFile, 'utf8'));
  known = new Set(j.tags ?? []);
}

function findPath() {
  const all = HID.devices().filter(
    (d) => d.vendorId === VID && d.productId === PID,
  );
  if (!all.length) return null;
  const v = all.find((d) => d.interface === VENDOR_INTERFACE);
  return (v ?? all[0]).path;
}

const path = findPath();
if (!path) {
  console.error('M62 не найден — подключи устройство');
  process.exit(1);
}

let dev;
try {
  dev = new HID.HID(path);
} catch (err) {
  console.error('не удалось открыть:', err.message);
  process.exit(2);
}

mkdirSync(dirname(outFile), { recursive: true });

const seen = new Map();
const changes = [];
const records = [];
const marks = [];
let reads = 0, idle = 0, bad = 0;

console.log(`\nСЕАНС: ${label}`);
console.log(`длительность: ${seconds} с   лог: ${outFile}`);
console.log('НИЧЕГО не отправляю в устройство — только читаю.\n');
console.log('Крути ручки в M Control Center. Enter — поставить метку шага.\n');

const t0 = Date.now();
const rl = createInterface({ input: process.stdin, output: process.stdout });
rl.on('line', () => {
  const t = Date.now() - t0;
  marks.push({ t, note: `метка ${marks.length + 1}` });
  console.log(`  --- метка ${marks.length} на ${t} ms ---`);
});

const ticker = setInterval(() => {
  const left = Math.ceil(seconds - (Date.now() - t0) / 1000);
  if (left <= 0) finish();
  else if (left % 15 === 0) process.stdout.write(`  [осталось ${left} с]\n`);
}, 250);

function finish() {
  clearInterval(ticker);
  rl.close();
  try { dev.close(); } catch { /* уже */ }

  const byKey = new Map();
  for (const c of changes) {
    if (!byKey.has(c.key)) byKey.set(c.key, []);
    byKey.get(c.key).push(c.value);
  }

  const knownArr = [...known];
  const newKeys = [...byKey.keys()].filter((k) => !known.has(k));

  console.log('\n' + '='.repeat(64));
  console.log(`ИТОГ СЕАНСА: ${label}`);
  console.log('='.repeat(64));
  console.log(`чтений ${reads}, холостых ${idle}, ошибок ${bad}`);
  console.log(`параметров менялось: ${byKey.size}, изменений: ${changes.length}`);

  console.log('\n--- что менялось (след твоих действий) ---');
  for (const [key, vals] of [...byKey.entries()].sort()) {
    const uniq = [...new Set(vals)];
    const fresh = known.has(key) ? '' : '   <<< НОВЫЙ';
    console.log(
      `  ${key.padEnd(8)} x${String(vals.length).padStart(4)}` +
      `  ${uniq.slice(0, 8).join(', ')}${uniq.length > 8 ? '…' : ''}${fresh}`,
    );
  }

  // Разбивка по меткам: какие теги менялись между метками.
  // Это главное для сопоставления «крутил X -> изменился Y».
  if (marks.length) {
    console.log('\n--- по шагам (между метками) ---');
    const bounds = [0, ...marks.map((m) => m.t), Infinity];
    for (let i = 0; i < bounds.length - 1; i++) {
      const lo = bounds[i], hi = bounds[i + 1];
      const inRange = changes.filter(
        (c) => (c.t ?? 0) >= lo && (c.t ?? 0) < hi,
      );
      const keys = [...new Set(inRange.map((c) => c.key))].sort();
      const steps = hi === Infinity ? 'конец' : `метка ${i + 1}`;
      console.log(`\n  [${lo}..${hi === Infinity ? '∞' : hi} ms] ${steps}`);
      if (!keys.length) {
        console.log('    (ничего не менялось)');
        continue;
      }
      for (const k of keys) {
        const vals = inRange.filter((c) => c.key === k).map((c) => c.value);
        const u = [...new Set(vals)];
        console.log(
          `    ${k.padEnd(8)} x${String(vals.length).padStart(3)}` +
          `  ${u.slice(0, 6).join(', ')}${u.length > 6 ? '…' : ''}`,
        );
      }
    }
  }

  if (newKeys.length) {
    console.log('\n--- НОВЫЕ ТЕГИ (не встречались раньше) ---');
    for (const k of newKeys) {
      const vals = byKey.get(k);
      console.log(`  ${k}   значения: ${[...new Set(vals)].join(', ')}`);
    }
  } else {
    console.log('\nновых тегов нет — всё это уже было известно');
  }

  writeFileSync(outFile, records.map((r) => JSON.stringify(r)).join('\n') + '\n');

  // дописываем новые теги в эталон
  for (const k of byKey.keys()) known.add(k);
  writeFileSync(
    baseFile,
    JSON.stringify({ tags: [...known].sort(), updated: new Date().toISOString() }, null, 2),
  );

  console.log(`\nлог: ${outFile}`);
  console.log(`эталон обновлён: ${baseFile} (${known.size} тегов)`);
  process.exit(0);
}

dev.on('data', (buf) => {
  reads++;
  const b = buf instanceof Uint8Array ? buf : Uint8Array.from(buf);

  let off = -1;
  for (let i = 0; i + 15 <= b.length; i++) {
    if (b[i] === 0x22 && b[i + 1] === 0x33 && b[i + 13] === 0x66 && b[i + 14] === 0x77) {
      off = i;
      break;
    }
  }
  if (off < 0) {
    let z = true;
    for (const x of b) if (x !== 0) { z = false; break; }
    if (z) idle++; else bad++;
    return;
  }

  const tt = b[off + 5], pp = b[off + 6];
  const value = (b[off + 7] << 24) | (b[off + 8] << 16) | (b[off + 9] << 8) | b[off + 10];
  const key = `${tt.toString(16).padStart(2, '0')}:${pp.toString(16).padStart(2, '0')}`;
  const prev = seen.get(key);
  const changed = prev !== value;
  seen.set(key, value);

  const t = Date.now() - t0;
  records.push({ t, tt, pp, value, changed, prev: prev ?? null });

  if (changed) {
    changes.push({ key, value, t });
    const fresh = known.has(key) ? '' : '   <<< НОВЫЙ';
    if (fresh) {
      console.log(`  +${String(t).padStart(6)} ms  ${key}  ${prev ?? '—'} -> ${value}${fresh}`);
    }
  }
});

dev.on('error', (err) => {
  console.error('ошибка HID:', err.message);
  finish();
});
