/**
 * СВЕРКА: все эндпоинты в коде против документации.
 *
 * Важно для передачи фронтендеру: в API.md не должно быть
 * ни пропущенных, ни несуществующих эндпоинтов.
 */
import { readFileSync } from 'node:fs';

const server = readFileSync('src/server.js', 'utf8');
const docs = readFileSync('docs/API.md', 'utf8');

// 1) вытащить все эндпоинты из кода
const codeEndpoints = new Set();
const re = /url\.pathname\s*===\s*'(\/api\/[^']+)'/g;
let m;
while ((m = re.exec(server)) !== null) codeEndpoints.add(m[1]);

// 2) вытащить из документации (в заголовках `METHOD /api/...`)
const docEndpoints = new Map();
const reDoc = /`(GET|POST)\s+(\/api\/[^`?\s]+)/g;
while ((m = reDoc.exec(docs)) !== null) {
  docEndpoints.set(m[2], m[1]);
}

// 3) сравнить
const inCodeNotDocs = [...codeEndpoints].filter((e) => !docEndpoints.has(e));
const inDocsNotCode = [...docEndpoints.keys()].filter((e) => !codeEndpoints.has(e));

console.log(`эндпоинтов в коде: ${codeEndpoints.size}`);
console.log(`эндпоинтов в документации: ${docEndpoints.size}\n`);

console.log('=== В КОДЕ, НО НЕ В ДОКУМЕНТАЦИИ ===');
if (inCodeNotDocs.length) {
  for (const e of inCodeNotDocs.sort()) console.log(`  ${e}`);
} else {
  console.log('  нет — всё задокументировано');
}

console.log('\n=== В ДОКУМЕНТАЦИИ, НО НЕТ В КОДЕ ===');
if (inDocsNotCode.length) {
  for (const e of inDocsNotCode.sort()) console.log(`  ${e}`);
} else {
  console.log('  нет — документация актуальна');
}

console.log('\n=== ВСЕ ЭНДПОИНТЫ ===');
const byMethod = { GET: [], POST: [] };
for (const e of codeEndpoints) {
  // определяем метод по контексту — ищем рядом в коде
  const idx = server.indexOf(`url.pathname === '${e}'`);
  const ctx = server.slice(Math.max(0, idx - 200), idx);
  const method = /req\.method\s*===\s*'(GET|POST)'/.test(ctx)
    ? ctx.match(/req\.method\s*===\s*'(GET|POST)'/g).pop().match(/'(\w+)'/)[1]
    : '?';
  (byMethod[method] ?? (byMethod[method] = [])).push(e);
}
for (const [method, list] of Object.entries(byMethod)) {
  console.log(`\n${method} (${list.length}):`);
  for (const e of list.sort()) console.log(`  ${e}`);
}

// 4) проверить WS-команды
console.log('\n=== WEBSOCKET-КОМАНДЫ ===');
const wsCmds = new Set();
const reWs = /msg\.type\s*===\s*'(\w+)'/g;
while ((m = reWs.exec(server)) !== null) wsCmds.add(m[1]);
console.log(`  в коде: ${[...wsCmds].join(', ')}`);
for (const c of wsCmds) {
  const documented = docs.includes(`"type": "${c}"`) || docs.includes(`\`${c}\``) || docs.includes(`"${c}"`);
  if (!documented) console.log(`  ⚠ не задокументирована: ${c}`);
}
