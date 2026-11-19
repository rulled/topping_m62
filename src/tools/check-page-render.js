/**
 * ПРОВЕРКА: страница отрисовывается в браузере без ошибок JS.
 *
 * ═══ ЗАЧЕМ ═══
 *
 * `check-page-script.js` проверяет синтаксис и наличие id. Но он не
 * поймает ошибку ВЫПОЛНЕНИЯ: например, обращение к свойству `null`
 * на старте, из-за которого рендер умирает и все карточки остаются
 * с прочерками. Синтаксис при этом целый.
 *
 * ═══ КАК ═══
 *
 * Запускаем headless Edge/Chrome и просим отдать DOM после
 * выполнения скриптов (`--dump-dom`). Затем смотрим, что:
 *   1. DOM содержит наши карточки;
 *   2. новые карточки (EQ наушников) на месте;
 *   3. в DOM нет признаков падения.
 *
 * ═══ ЧЕГО ЭТО НЕ ПРОВЕРЯЕТ ═══
 *
 * WebHID в headless недоступен: `navigator.hid` отсутствует, поэтому
 * подключиться к карте нельзя. Проверяется только то, что страница
 * грузится и рисует разметку. Реальная работа с устройством —
 * только в видимом окне.
 *
 * ═══ ПОЧЕМУ НЕ Start-Process ИЗ POWERSHELL ═══
 *
 * В этом окружении `Start-Process` с перенаправлением вывода падает
 * на дублирующемся ключе `no_proxy`/`NO_PROXY`. Поэтому запускаем
 * через `execFile` из Node.
 *
 * Запуск: node src/tools/check-page-render.js [--port 8898]
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ensureServer } from './_server-fixture.js';

const PORT = (() => {
  const i = process.argv.indexOf('--port');
  return i >= 0 ? Number(process.argv[i + 1]) : 8898;
})();

/**
 * ПОДНЯТЬ СЕРВЕР, ЕСЛИ ОН НЕ ПОДНЯТ.
 *
 * Раньше эта проверка требовала, чтобы кто-то снаружи уже слушал
 * порт: она просто открывала `http://127.0.0.1:<PORT>/`. В итоге
 * `npm run test:server` с чистого листа падал на «DOM получен
 * (0 байт)» — браузер получал отказ в соединении, и это выглядело
 * как поломка вёрстки, а не как незапущенный сервер.
 *
 * Общий подъём живёт в `_server-fixture.js`, чтобы не держать две
 * копии одной логики.
 */
const server = await ensureServer(PORT);
if (server.owned) console.log(`сервер: поднят на :${PORT} (закрывается вместе с проверкой)`);
else console.log(`сервер: используется уже запущенный на :${PORT}`);

const CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];

const browser = CANDIDATES.find((p) => existsSync(p));
if (!browser) {
  console.log('браузер не найден — проверка пропущена');
  process.exit(0);
}

let ok = 0;
let fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { ok += 1; console.log(`  OK    ${name}`); }
  else { fail += 1; console.log(`  FAIL  ${name}${detail ? `  (${detail})` : ''}`); }
};

const udd = join(tmpdir(), `m62-render-${process.pid}`);
const args = [
  '--headless=new',
  '--disable-gpu',
  '--no-sandbox',
  '--disable-dev-shm-usage',
  `--user-data-dir=${udd}`,
  '--virtual-time-budget=9000',
  '--dump-dom',
  `http://127.0.0.1:${PORT}/`,
];

const dom = await new Promise((done) => {
  execFile(browser, args, { maxBuffer: 32 * 1024 * 1024, timeout: 90000 }, (err, stdout) => {
    done({ err, stdout: stdout ?? '' });
  });
});

console.log(`браузер: ${browser}`);
console.log(`DOM:     ${dom.stdout.length} байт\n`);

check('DOM получен', dom.stdout.length > 5000, `${dom.stdout.length} байт`);
if (!dom.stdout.length) {
  console.log(`\nвывод браузера: ${String(dom.err?.message ?? '').slice(0, 400)}`);
  process.exitCode = 1;
} else {
  const html = dom.stdout;

  // ─── карточки на месте ───
  for (const id of ['eqBands', 'eqHpCard', 'eqHpNote', 'eqHpFields', 'eqBands']) {
    check(`карточка #${id} в DOM`, html.includes(`id="${id}"`));
  }

  // ─── EQ входов построен скриптом ───
  //
  // `buildEqControls()` создаёт 4 полосы динамически. Если скрипт
  // упал на старте, разметки полос не будет вовсе — а она есть
  // только в результате работы JS, не в исходном HTML.
  const bandCount = (html.match(/полоса \d/g) ?? []).length;
  check('EQ входов построен (4 полосы)', bandCount >= 4, `${bandCount}`);

  // ─── EQ наушников: список 10 полос ───
  //
  // `buildHpControls()` заполняет select. Считаем option внутри
  // #eqHpBand — их должно быть 10.
  const bandSel = html.match(/id="eqHpBand"[^>]*>([\s\S]*?)<\/select>/);
  const hpOptions = bandSel ? (bandSel[1].match(/<option/g) ?? []).length : 0;
  check('EQ наушников: 10 полос в списке', hpOptions === 10, `${hpOptions}`);

  // ─── микшер: 5 шин и 11 источников ───
  //
  // `buildMixerControls()` заполняет список шин, `buildMixerRows()`
  // строит строки источников. Обе функции — результат работы JS:
  // в исходном HTML этих элементов нет.
  const busSel = html.match(/id="mixerBus"[^>]*>([\s\S]*?)<\/select>/);
  const busOptions = busSel ? (busSel[1].match(/<option/g) ?? []).length : 0;
  check('микшер: 5 шин в списке', busOptions === 5, `${busOptions}`);

  // Ползунки источников имеют id вида mx_<source>_l.
  const mxSliders = (html.match(/id="mx_[a-z0-9]+_l"/g) ?? []).length;
  check('микшер: строки источников построены', mxSliders === 11, `${mxSliders}`);

  // Предупреждение о том, что состояние не с карты, обязано быть.
  check(
    'микшер: предупреждение о модели видно',
    /Состояние — наше, не с карты|не отдаёт микшер/.test(html),
  );

  // ─── сцены ───
  //
  // `renderSceneList()` заполняет select. Пустой список — это один
  // пункт «нет сохранённых», он тоже строится скриптом.
  const sceneSel = html.match(/id="sceneList"[^>]*>([\s\S]*?)<\/select>/);
  const sceneOptions = sceneSel ? (sceneSel[1].match(/<option/g) ?? []).length : 0;
  check('сцены: список построен', sceneOptions >= 1, `${sceneOptions}`);

  // Сцена обязана честно говорить о микшере.
  check(
    'сцены: оговорка про микшер видна',
    /Микшер она восстановит из нашей\s*модели|восстановит из нашей/.test(html),
  );

  // ─── mutes ───
  //
  // `buildMuteRows()` строит 7 кнопок вида mt_<id>.
  const muteBtns = (html.match(/id="mt_[a-zA-Z0-9]+"/g) ?? []).length;
  check('mutes: 7 кнопок построено', muteBtns === 7, `${muteBtns}`);

  // ─── loopback ───
  //
  // `buildLoopbackRows()` строит 4 ползунка вида lb_<id>_gain.
  const lbGains = (html.match(/id="lb_[a-z0-9]+_gain"/g) ?? []).length;
  check('loopback: 4 гейна построено', lbGains === 4, `${lbGains}`);

  const lbSrcs = (html.match(/id="lb_[a-z0-9]+_src"/g) ?? []).length;
  check('loopback: 4 селектора построено', lbSrcs === 4, `${lbSrcs}`);

  // loopback обязан честно говорить, что состояние не с карты.
  check(
    'loopback: предупреждение о модели видно',
    /Гейн и источник loopback карта\s*не отдаёт|не отдаёт/.test(html),
  );

  // ─── батарея ───
  check('батарея: строка в карточке устройства', html.includes('id="dBattery"'));

  // ─── в headless WebHID нет: страница должна честно сказать ───
  check(
    'страница сообщает об отсутствии WebHID',
    /не поддерживает WebHID|Chrome или Edge/i.test(html),
  );

  // ─── признаков падения ───
  check('нет "null" в статусе устройства', !/>null</.test(html));
}

console.log(`\n${'='.repeat(60)}`);
console.log(`  пройдено: ${ok}`);
console.log(`  провалено: ${fail}`);

// Закрываем сервер ТОЛЬКО если поднимали его сами: чужой процесс
// (поднятый вручную или соседним тестом) не наше дело.
await server.close();

process.exitCode = fail === 0 ? 0 : 1;
