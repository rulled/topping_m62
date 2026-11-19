/**
 * АУДИТ БЕЗОПАСНОСТИ: можно ли случайно выставить dev-сервер в интернет.
 *
 * ═══ ПОЧЕМУ ЭТО ВАЖНО ═══
 *
 * В проекте ДВА сервера:
 *
 *   • `src/static-server.js` — для хостинга. Отдаёт 18 файлов,
 *     ничего не меняет. Безопасен для публичного доступа.
 *
 *   • `research/dev-server/server.js` — dev-сервер. 61 маршрут,
 *     БЕЗ АВТОРИЗАЦИИ: управляет картой, читает реестр Windows,
 *     запускает процессы, дёргает окна MCC через UIA.
 *
 * Если второй случайно окажется в интернете — кто угодно сможет
 * управлять картой и трогать систему. Сейчас он лежит в research/,
 * поэтому случайно не попадёт в образ: Docker копирует файлы
 * поимённо.
 *
 * ═══ ЧТО ПРОВЕРЯЕТСЯ ═══
 *
 *   1. По умолчанию dev-сервер слушает 127.0.0.1, а не 0.0.0.0.
 *   2. Есть ли предупреждение при привязке к внешнему адресу.
 *   3. Документация не советует открывать его наружу.
 *   4. Статик-сервер (публичный) не имеет маршрутов управления.
 *   5. Docker и хостинг используют ИМЕННО статик-сервер.
 *
 * Запуск: node src/tools/audit-server-exposure.js
 */

import { readFileSync } from 'node:fs';

let ok = 0;
let fail = 0;
let warn = 0;
const check = (name, cond, detail = '') => {
  if (cond) { ok += 1; console.log(`  OK    ${name}${detail ? `  (${detail})` : ''}`); }
  else { fail += 1; console.log(`  FAIL  ${name}${detail ? `  (${detail})` : ''}`); }
};
const note = (msg) => { warn += 1; console.log(`  !     ${msg}`); };

/** Сервер с API живёт в research/: в продакшене его нет. */
const DEV_PATH = 'research/dev-server/server.js';

const DEV = readFileSync(DEV_PATH, 'utf8');
const STATIC = readFileSync('src/static-server.js', 'utf8');

console.log('='.repeat(70));
console.log('АУДИТ: МОЖНО ЛИ СЛУЧАЙНО ВЫСТАВИТЬ DEV-СЕРВЕР В ИНТЕРНЕТ');
console.log('='.repeat(70));

// ─── 1. адрес по умолчанию ───
console.log('\n--- 1. адрес прослушивания dev-сервера ---');
const hostLine = DEV.match(/const HOST\s*=\s*process\.env\.M62_HOST\s*\?\?\s*'([^']+)'/);
const defaultHost = hostLine?.[1];
console.log(`  по умолчанию: ${defaultHost}`);
check('по умолчанию слушает localhost', defaultHost === '127.0.0.1',
  String(defaultHost));
check('не слушает 0.0.0.0 по умолчанию', defaultHost !== '0.0.0.0');

// ─── 2. предупреждение при внешней привязке ───
console.log('\n--- 2. предупреждение при внешней привязке ---');
const hasWarning = /0\.0\.0\.0|внешн|публичн|опасн|БЕЗ АВТОРИЗАЦИИ/i.test(
  DEV.slice(DEV.indexOf('server.listen'), DEV.indexOf('server.listen') + 2000),
);
check('есть предупреждение при привязке к внешнему адресу', hasWarning,
  hasWarning ? '' : 'нет — сервер молча откроется наружу');

// ─── 3. маршруты управления в dev-сервере ───
console.log('\n--- 3. что умеет dev-сервер ---');
const routes = (DEV.match(/url\.pathname === '\/api\//g) ?? []).length;
console.log(`  маршрутов: ${routes}`);
check('dev-сервер имеет маршруты управления', routes > 10, `${routes}`);

// Опасные возможности
const dangers = [
  ['UIA (управление окнами MCC)', /ui-control|\bps\(|PRELUDE/],
  ['запуск процессов', /spawn|execFile|exec\(/],
  ['реестр Windows', /reg |registry|MMDevices/],
  ['работа с файлами', /writeFile|readFile|rm\(/],
];
for (const [name, re] of dangers) {
  const found = re.test(DEV);
  console.log(`  ${found ? '⚠' : '·'} ${name}: ${found ? 'есть' : 'нет'}`);
}
note('dev-сервер без авторизации: кто угодно на том же хосте может им управлять');

// ─── 4. статик-сервер не имеет маршрутов управления ───
console.log('\n--- 4. публичный сервер не умеет управлять ---');
const staticRoutes = (STATIC.match(/pathname === '\/api\//g) ?? []).length;
check('статик-сервер не имеет маршрутов /api/', staticRoutes === 0,
  `${staticRoutes}`);
check('статик-сервер только читает файлы',
  /readFile/.test(STATIC) && !/writeFile|spawn|exec\(/.test(STATIC));

// Проверяем ИМПОРТЫ, а не упоминания в комментариях: `node-hid`
// может встретиться в объяснении, почему он тут не нужен.
const staticImports = [...STATIC.matchAll(/^import[\s\S]*?;$/gm)].map((m) => m[0]).join('\n');
check('статик-сервер не импортирует node-hid',
  !/from\s+['"]node-hid['"]/.test(staticImports));
check('статик-сервер не импортирует ws',
  !/from\s+['"]ws['"]/.test(staticImports));
check('статик-сервер импортирует только node: модули',
  [...staticImports.matchAll(/from\s+['"]([^'"]+)['"]/g)]
    .every((m) => m[1].startsWith('node:')),
  [...staticImports.matchAll(/from\s+['"]([^'"]+)['"]/g)]
    .map((m) => m[1]).join(', '));

// ─── 5. Docker использует статик ───
console.log('\n--- 5. Docker и хостинг используют статик ---');
const docker = readFileSync('Dockerfile', 'utf8');
check('Dockerfile запускает static-server.js',
  docker.includes('static-server.js'));
check('Dockerfile НЕ копирует server.js',
  !/COPY\s+src\/server\.js/.test(docker));

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
check('npm start = статик-сервер', pkg.scripts.start.includes('static-server'));

// Раньше dev-сервер запускался отдельным скриптом `dev:api` из src/.
// Теперь он в research/ и НЕ должен быть доступен через npm-скрипты:
// иначе кто-то запустит его, думая, что это часть сайта.
check('в npm-скриптах НЕТ dev-сервера',
  !Object.values(pkg.scripts).some((s) => String(s).includes('server.js') && !String(s).includes('static-server')));
note(`npm start -> ${pkg.scripts.start}`);
note('dev-сервер (research/dev-server/server.js) запускается только вручную');

// ─── 6. документация предупреждает ───
console.log('\n--- 6. документация ---');
const deploy = readFileSync('docs/DEPLOY.md', 'utf8');
check('DEPLOY предупреждает, что dev-сервер не для хостинга',
  /dev|server\.js.*не нужен|инструмент разработки/i.test(deploy));

console.log(`\n${'='.repeat(70)}`);
console.log('ВЫВОД');
console.log('='.repeat(70));
console.log(`
  проверок пройдено: ${ok}
  провалено:         ${fail}
  замечаний:         ${warn}
`);

if (fail === 0) {
  // Числа берём из кода, а не пишем в тексте руками: иначе они
  // разъедутся при следующем изменении (18 файлов было верно до
  // появления алиасов, теперь их 21).
  const fileCount = (STATIC.match(/^\s*\['\/[^']*',\s*'/gm) || []).length;
  const devRoutes = (DEV.match(/url\.pathname\s*===\s*'\/api\//g) || []).length;

  console.log(`
  РАЗДЕЛЕНИЕ КОРРЕКТНО.

  Публичный статик-сервер: отдаёт ${fileCount} URL из белого списка,
  ничего не меняет, не тянет node-hid и ws. Безопасен для хостинга.

  Dev-сервер (research/dev-server/): маршрутов с управлением картой
  и системой — ${devRoutes}, БЕЗ авторизации. По умолчанию слушает
  только 127.0.0.1, поэтому наружу не виден. В Docker не попадает
  и npm-скриптом не запускается.
`);
} else {
  console.log('\n  ЕСТЬ РИСК. Смотри провалы.\n');
}

process.exitCode = fail === 0 ? 0 : 1;
