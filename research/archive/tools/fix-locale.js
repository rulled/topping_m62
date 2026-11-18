/**
 * Исправить все места с Number(ps(...scale...)) — добавить нормализацию запятой.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const FILES = [
  'src/tools/calibrate-dial.js',
  'src/tools/find-compressor-dials.js',
  'src/tools/map-compressor-wheel.js',
  'src/tools/map-reverb-dials.js',
  'src/tools/restore-gain.js',
  'src/tools/test-dial-wheel.js',
  'src/tools/test-wheel-all.js',
  'src/tools/test-live-apply-ui.js',
  'src/tools/diag-reverb-dial.js',
  'src/tools/test-memory.js',
];

let total = 0;
for (const f of FILES) {
  let src;
  try { src = readFileSync(f, 'utf8'); } catch { continue; }
  const before = src;

  // Number(ps(PRELUDE + 'Write-Output $script:scale').trim())  ->  число с запятой
  src = src.replace(
    /Number\(ps\(PRELUDE \+ 'Write-Output \$script:scale'\)\.trim\(\)\)/g,
    "Number(ps(PRELUDE + 'Write-Output $script:scale').trim().replace(',', '.'))",
  );

  // Number(out) где out = ps(...scale...)
  src = src.replace(
    /const scaleOut = ps\(PRELUDE \+ 'Write-Output \$script:scale'\);\s*\n(\s*)const scale = Number\(scaleOut\) \|\| 1;/g,
    "const scaleOut = ps(PRELUDE + 'Write-Output $script:scale').trim().replace(',', '.');\n$1const scale = Number(scaleOut) || 1.75;",
  );

  // Number(out) в test-memory и подобных — общая нормализация
  src = src.replace(/(\n\s*)const n = Number\(out\);/g, "$1const n = Number(String(out).replace(',', '.'));");

  if (src !== before) {
    writeFileSync(f, src, 'utf8');
    total++;
    console.log(`исправлен: ${f}`);
  }
}

console.log(`\nвсего исправлено файлов: ${total}`);
