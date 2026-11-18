/**
 * ПОИСК ТОГО ЖЕ БАГА ЛОКАЛИ в других модулях.
 *
 * Ищем все Number(...) над выводом PowerShell — они могут получить "1,75".
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    const st = statSync(p);
    if (st.isDirectory()) { if (f !== 'node_modules') walk(p, out); }
    else if (f.endsWith('.js')) out.push(p);
  }
  return out;
}

const files = walk('src');
console.log(`проверяю файлов: ${files.length}\n`);

const SUSPICIOUS = [];
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const lines = src.split(/\r?\n/);
  lines.forEach((line, idx) => {
    // Number(ps(...)) или Number(out) где out из ps
    if (/Number\s*\(\s*(ps|out|raw|scaleOut|res|result)/.test(line)) {
      SUSPICIOUS.push({ file: f, line: idx + 1, text: line.trim() });
    }
    // parseInt/parseFloat над ps
    if (/parse(Float|Int)\s*\(\s*(ps|out|raw)/.test(line)) {
      SUSPICIOUS.push({ file: f, line: idx + 1, text: line.trim() });
    }
    // сравнение === с числом из stdout
    if (/===?\s*Number\(/.test(line) && /ps\(/.test(line)) {
      SUSPICIOUS.push({ file: f, line: idx + 1, text: line.trim() });
    }
  });
}

console.log(`=== ПОДОЗРИТЕЛЬНЫЕ МЕСТА (${SUSPICIOUS.length}) ===\n`);
for (const s of SUSPICIOUS) {
  console.log(`  ${s.file}:${s.line}`);
  console.log(`    ${s.text}`);
}

console.log('\n=== РЕКОМЕНДАЦИЯ ===');
console.log('Везде, где парсится число из вывода powershell.exe,');
console.log('нужно: String(out).replace(",", ".") перед Number().');
