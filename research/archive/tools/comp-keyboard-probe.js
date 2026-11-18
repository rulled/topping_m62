/**
 * ПРОБА КЛАВИАТУРЫ НА ДИЛАХ КОМПРЕССОРА.
 *
 * Дилы EQ принимают стрелки после SetFocus (NOTES §110).
 * Раньше компрессор проверяли только drag и колесом — клавиатуру не пробовали.
 *
 * Безопасность: HP должен быть замьючен (проверяется выше отдельным скриптом).
 */
import { findActiveWorkspace, readWorkspace } from '../workspace.js';
import { ps, PRELUDE } from './uia.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const comp = () => {
  const ws = findActiveWorkspace();
  const c = readWorkspace(ws.path).Compressor ?? {};
  return {
    switch: String(c.Switch),
    thr: Number(c.Threshold), ratio: Number(c.Ratio), att: Number(c.Attack),
    rel: Number(c.Release), gain: Number(c.Gain), mix: Number(c.Mix),
    auto: String(c.GainAuto),
  };
};

const PARAMS = ['Threshold', 'Ratio', 'Attack', 'Release', 'Gain', 'Mix'];

/** Найти дил в окне компрессора по AutomationId (заканчивается на .<Param>). */
function findDial(param) {
  const raw = PRELUDE + [
    'try {',
    '  $p = Get-Process -Name "M Control Center" -ErrorAction Stop | Select-Object -First 1',
    '  $root = [System.Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)',
    '} catch { Write-Output "NO_MCC"; exit }',
    'if ($root -eq $null) { Write-Output "NO_ROOT"; exit }',
    '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    '$hit = $null',
    'for ($i=0; $i -lt $all.Count; $i++) {',
    '  $e = $all.Item($i)',
    `  if ($e.Current.AutomationId -match 'Compressor.*\\.${param}$') { $hit = $e; break }`,
    '}',
    'if ($hit -eq $null) { Write-Output "NOT_FOUND"; exit }',
    'try { $hit.SetFocus(); Start-Sleep -Milliseconds 120 } catch { Write-Output ("FOCUS_ERR " + $_); exit }',
    'Write-Output ("OK " + $hit.Current.ClassName)',
  ].join('\n');
  return ps(raw).trim();
}

async function pressKey(key, times) {
  const raw = PRELUDE + [
    'Add-Type -AssemblyName System.Windows.Forms',
    `for ($i=0; $i -lt ${times}; $i++) {`,
    `  [System.Windows.Forms.SendKeys]::SendWait("${key}")`,
    '  Start-Sleep -Milliseconds 110',
    '}',
    'Write-Output SENT',
  ].join('\n');
  return ps(raw).trim();
}

console.log('=== КЛАВИАТУРНАЯ ПРОБА КОМПРЕССОРА ===\n');
const before = comp();
console.log('до:', JSON.stringify(before));
console.log('');

const results = [];

for (const param of PARAMS) {
  const b = comp();
  const f = findDial(param);
  if (!f.startsWith('OK')) {
    console.log(`${param.padEnd(10)} фокус: ${f}`);
    results.push({ param, status: f });
    continue;
  }
  // 2 нажатия UP
  await pressKey('{UP}', 2);
  await sleep(900);
  const a = comp();

  const changed = Object.keys(b).filter((k) => a[k] !== b[k]);
  console.log(`${param.padEnd(10)} focus=OK  ${changed.length ? changed.map((k) => `${k}: ${b[k]} -> ${a[k]}`).join(', ') : '— без изменений'}`);
  results.push({ param, changed, b, a });

  // откат: 2 нажатия DOWN
  if (changed.length) {
    await pressKey('{DOWN}', 2);
    await sleep(900);
    const c2 = comp();
    const back = changed.every((k) => c2[k] === b[k]);
    console.log(`${''.padEnd(10)} откат DOWN x2: ${back ? 'восстановлено' : 'НЕ восстановлено: ' + JSON.stringify(c2)}`);
  }
}

console.log('\n=== ИТОГ ===');
for (const r of results) {
  console.log(`  ${r.param.padEnd(10)} ${r.status ?? (r.changed.length ? r.changed.join(',') : 'НЕТ')}`);
}
console.log('\nтекущее:', JSON.stringify(comp()));
