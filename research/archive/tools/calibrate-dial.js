/**
 * ТОЧНОЕ УПРАВЛЕНИЕ КОМПРЕССОРОМ через замкнутый контур.
 *
 * Идея: dial не даёт задать значение напрямую, но мы можем:
 *   1) потянуть на вычисленное число пикселей
 *   2) ИЗМЕРИТЬ что получилось (через файл)
 *   3) скорректировать остаток
 *   4) повторять пока не попадём в цель
 *
 * Чувствительность измеряется на лету (ед/px), поэтому работает
 * для любого параметра и не зависит от калибровки заранее.
 */
import { execFileSync } from 'node:child_process';
import { findActiveWorkspace, readWorkspace } from '../workspace.js';
import { ps, PRELUDE } from './uia.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PS = 'powershell.exe';

/** Координаты dial'ов компрессора (логические пиксели). */
export const DIALS = {
  threshold: { x: 756, y: 1302 },
  ratio: { x: 958, y: 1384 },
  attack: { x: 1020, y: 1262 },
  release: { x: 1086, y: 1384 },
  gain: { x: 756, y: 1464 },
};

/** Прочитать текущее значение параметра компрессора из файла. */
function readParam(name) {
  const ws = findActiveWorkspace();
  const c = readWorkspace(ws.path).Compressor ?? {};
  const KEY = {
    threshold: 'Threshold', ratio: 'Ratio', attack: 'Attack',
    release: 'Release', gain: 'Gain', mix: 'Mix',
  };
  const v = c[KEY[name]];
  return v === undefined ? null : Number(v);
}

function scale() {
  try {
    const out = ps(PRELUDE + 'Write-Output $script:scale').trim();
    const n = Number(String(out).replace(',', '.'));
    return Number.isFinite(n) && n > 0 ? n : 1.75;
  } catch {
    return 1.75;
  }
}

const SCALE = scale();

function dragPx(dial, dyPx) {
  const px = Math.round(dial.x / SCALE);
  const py = Math.round(dial.y / SCALE);
  const SCRIPT = String.raw`
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class MSC {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
}
'@
[MSC]::SetCursorPos(${px}, ${py})
Start-Sleep -Milliseconds 250
[MSC]::mouse_event(0x0002,0,0,0,[IntPtr]::Zero)
Start-Sleep -Milliseconds 150
$steps = 10
for ($i=1; $i -le $steps; $i++) {
  [MSC]::SetCursorPos(${px}, ${py} + [int]((${dyPx} / $steps) * $i))
  Start-Sleep -Milliseconds 35
}
Start-Sleep -Milliseconds 150
[MSC]::mouse_event(0x0004,0,0,0,[IntPtr]::Zero)
`;
  execFileSync(PS, ['-NoProfile', '-Command', SCRIPT], { encoding: 'utf8' });
}

/**
 * Выставить параметр компрессора с точностью до единицы.
 *
 * @param {'threshold'|'ratio'|'attack'|'release'|'gain'} name
 * @param {number} target
 * @param {{maxIter?: number, tolerance?: number}} [opts]
 */
export async function setCompressorParam(name, target, opts = {}) {
  const { maxIter = 8, tolerance = 0.5 } = opts;

  const dial = DIALS[name];
  if (!dial) throw new Error(`неизвестный параметр: ${name}; допустимо: ${Object.keys(DIALS).join(', ')}`);

  let cur = readParam(name);
  if (cur === null) throw new Error(`не удалось прочитать ${name} из workspace`);

  const log = [];
  let sens = null; // ед/px, измеряется на лету

  for (let iter = 1; iter <= maxIter; iter++) {
    cur = readParam(name);
    const need = target - cur;
    if (Math.abs(need) <= tolerance) {
      return { name, target, final: cur, iterations: iter - 1, ok: true, log };
    }

    // если чувствительность неизвестна — измеряем пробным движением
    if (sens === null) {
      const probePx = 20;
      const before = cur;
      dragPx(dial, probePx);
      await sleep(1500);
      const after = readParam(name);
      const d = after - before;
      log.push(`калибровка: ${before} -> ${after} за ${probePx}px`);
      if (d !== 0) {
        sens = d / probePx;
      } else {
        // не сдвинулось — возможно, на границе диапазона
        log.push('движение не дало эффекта (граница диапазона?)');
        return { name, target, final: after, iterations: iter, ok: false, log };
      }
      continue;
    }

    // вычисляем нужное движение
    let px = Math.round(need / sens);
    // ограничиваем разумно
    if (px === 0) px = need > 0 ? 1 : -1;
    px = Math.max(-300, Math.min(300, px));
    log.push(`итерация ${iter}: ${cur} -> цель ${target}, тяну ${px}px`);
    dragPx(dial, px);
    await sleep(1600);
  }

  const final = readParam(name);
  return {
    name, target, final,
    iterations: maxIter,
    ok: Math.abs(final - target) <= tolerance,
    log,
  };
}

// CLI — запускается только если файл вызван напрямую
const isMain = (() => {
  try {
    if (!process.argv[1]) return false;
    const selfPath = new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
    return decodeURIComponent(selfPath).replace(/\\/g, '/').toLowerCase()
      === process.argv[1].replace(/\\/g, '/').toLowerCase();
  } catch {
    return false;
  }
})();

if (isMain) {
  const name = process.argv[2];
  const target = Number(process.argv[3]);
  if (!name || !Number.isFinite(target)) {
    console.log('использование: node calibrate-dial.js <threshold|ratio|attack|release|gain> <значение>');
    process.exit(1);
  }
  const r = await setCompressorParam(name, target);
  console.log(`\n${name}: цель ${r.target}, получилось ${r.final} (${r.ok ? 'OK' : 'не попали'})`);
  console.log(`итераций: ${r.iterations}`);
  if (r.log.length) {
    console.log('ход:');
    for (const l of r.log) console.log('  ' + l);
  }
  process.exit(r.ok ? 0 : 1);
}
