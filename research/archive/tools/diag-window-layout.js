/**
 * Диагностика: где кнопки реверба теперь, если окно изменило размер.
 *
 * Ищем все QPushButton и смотрим, где они.
 */
import { dumpTree } from './uia.js';

const { items } = dumpTree();

// все QPushButton
const btns = items.filter((x) => /QPushButton/.test(x.cls ?? '')).sort((a, b) => a.ly - b.ly || a.lx - b.lx);
console.log(`=== ВСЕ QPushButton (${btns.length}) ===`);
for (const b of btns) {
  const nm = (b.name || '').replace(/\n/g, '/').slice(0, 20);
  console.log(`  [${String(b.i).padStart(3)}] (${String(b.lx).padStart(4)},${String(b.ly).padStart(4)}) "${nm}"`);
}

// ищем диалы — они рядом с ревербом
console.log('\n=== ДИАЛЫ ===');
const dials = items.filter((x) => /Dial/.test(x.cls ?? '')).sort((a, b) => a.ly - b.ly || a.lx - b.lx);
for (const d of dials) {
  console.log(`  [${String(d.i).padStart(3)}] ${d.cls.padEnd(12)} (${String(d.lx).padStart(4)},${String(d.ly).padStart(4)})`);
}

// подписи реверба — где они
console.log('\n=== ПОДПИСИ РЕВЕРБА ===');
const revLabels = items.filter((x) => x.cls === 'QLabel' && x.name && /^(Dry|Wet|Room Size|Decay|Width|Reverb)$/i.test(x.name.trim()));
for (const l of revLabels) console.log(`  (${l.lx},${l.ly}) "${l.name}"`);

// окно
console.log('\n=== ГРАНИЦЫ ОКНА ===');
const RAW = `
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$p = Get-Process -Name "M Control Center" -ErrorAction SilentlyContinue | Select-Object -First 1
$cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $p.Id)
$tops = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)
for ($i = 0; $i -lt $tops.Count; $i++) {
  $w = $tops.Item($i)
  if ($w.Current.ClassName -eq "MainWindow_M62") {
    $r = $w.Current.BoundingRectangle
    Write-Output ("  окно: " + $r.X + "," + $r.Y + " " + $r.Width + "x" + $r.Height)
  }
}
`;
const { ps } = await import('./uia.js');
try { console.log(ps(RAW)); } catch { /* */ }
