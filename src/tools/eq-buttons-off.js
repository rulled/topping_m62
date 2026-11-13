/**
 * Состояние кнопок EQ в MCC + возврат в выключенное.
 *
 * Нужен, потому что prove-9b0f-vs-mcc.js оставил EQ IN1 включённым
 * (второй TogglePattern показал «On» вместо «Off» — состояние
 * кнопки в UIA кешируется и его надо перечитывать заново).
 */

import { ps, PRELUDE } from './uia.js';

const state = () =>
  ps(PRELUDE + String.raw`
$root = Get-MccRoot
$all = Get-MccAll $root
$out = @()
for ($i=0; $i -lt $all.Count; $i++) {
  $e = $all.Item($i); $aid=''; try { $aid = $e.Current.AutomationId } catch {}
  if ($aid -match 'PushButtonEQ$') {
    $st = 'NOPATTERN'
    try { $p=$null; if ($e.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern,[ref]$p)) { $st = ([System.Windows.Automation.TogglePattern]$p).Current.ToggleState.ToString() } } catch {}
    $w = 'IN1'; if ($aid -match 'Input_IN2') { $w = 'IN2' }
    $out += ($w + "|" + $i + "|" + $st)
  }
}
Write-Output ($out -join "//")
`).trim().split('//').filter(Boolean);

const setOff = (which) =>
  ps(PRELUDE + String.raw`
$root = Get-MccRoot
$all = Get-MccAll $root
for ($i=0; $i -lt $all.Count; $i++) {
  $e = $all.Item($i); $aid=''; try { $aid = $e.Current.AutomationId } catch {}
  if ($aid -match 'PushButtonEQ$') {
    $w = 'IN1'; if ($aid -match 'Input_IN2') { $w = 'IN2' }
    if ($w -ne '${which}') { continue }
    $p=$null
    if (-not $e.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern,[ref]$p)) { Write-Output "NOPATTERN"; return }
    $tp = [System.Windows.Automation.TogglePattern]$p
    if ($tp.Current.ToggleState.ToString() -eq 'On') {
      $tp.Toggle()
      Start-Sleep -Milliseconds 400
      Write-Output ("toggled off, now: " + $tp.Current.ToggleState.ToString())
    } else {
      Write-Output "already off"
    }
    return
  }
}
Write-Output "NOTFOUND"
`).trim();

console.log('текущее состояние:');
for (const s of state()) console.log('  ' + s);

for (const w of ['IN1', 'IN2']) {
  console.log(`\nвыключаю ${w}:`);
  console.log('  ' + setOff(w));
}

console.log('\nпосле:');
for (const s of state()) console.log('  ' + s);
