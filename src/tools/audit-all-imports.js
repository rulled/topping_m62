/**
 * АУДИТ ВСЕХ МОДУЛЕЙ: есть ли импорт используемых функций?
 *
 * Ищем случай, как с dumpTree: функция используется, но не импортирована.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (f.endsWith('.js')) out.push(p);
  }
  return out;
}

const files = walk('src');
console.log(`проверяю ${files.length} файлов\n`);

// функции из наших модулей, которые часто используются
const OUR_FUNCS = new Set([
  'dumpTree', 'ps', 'PRELUDE', 'buildFrame', 'withReportId', 'parseReport', 'isIdle',
  'findActiveWorkspace', 'readWorkspace', 'writeWorkspace', 'listWorkspaces', 'parseAll',
  'captureSnapshot', 'applySnapshot', 'readSnapshot', 'diffSnapshots',
  'describeMode', 'detectMode', 'detectModeFromHid', 'checkModeConsistency',
  'setReverbType', 'clickAt', 'clickByName', 'ensureReverbPanelOpen', 'findReverbButtons',
  'readEqSwitch', 'setEqSwitch', 'readEqTypes', 'describeEq', 'isEqWindowOpen',
  'classifyTag', 'describeTags', 'nudgeReverb',
]);

const problems = [];

for (const f of files) {
  const src = readFileSync(f, 'utf8');

  const imported = new Set();
  const reImp = /import\s*\{([^}]+)\}/g;
  let m;
  while ((m = reImp.exec(src)) !== null) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop().trim();
      if (name) imported.add(name);
    }
  }

  const defined = new Set();
  const reDef = /(?:function|const|let|class)\s+([a-zA-Z_$][\w$]*)/g;
  while ((m = reDef.exec(src)) !== null) defined.add(m[1]);

  // ищем вызовы наших функций
  for (const fn of OUR_FUNCS) {
    // вызов вида fn( но не .fn(
    const re = new RegExp(`(^|[^.\\w])${fn}\\s*\\(`, 'm');
    if (!re.test(src)) continue;
    if (imported.has(fn) || defined.has(fn)) continue;
    problems.push({ file: f, fn });
  }
}

console.log('=== ПРОБЛЕМЫ ===');
if (problems.length === 0) {
  console.log('  нет — все используемые функции импортированы');
} else {
  for (const p of problems) {
    console.log(`  ${p.file}: использует "${p.fn}" без импорта`);
  }
}
