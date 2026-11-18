/**
 * Диагностика: что сейчас в UI MCC?
 */
import { ps, PRELUDE } from './uia.js';

const RAW = PRELUDE + [
  'Add-Type -AssemblyName System.Windows.Forms',
  '$procs = Get-Process -Name "M Control Center" -ErrorAction SilentlyContinue',
  'foreach ($p in $procs) {',
  '  Write-Output ("PID=" + $p.Id + " title=" + $p.MainWindowTitle + " responding=" + $p.Responding)',
  '  if ($p.MainWindowHandle -ne [IntPtr]::Zero) {',
  '    $root = [System.Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)',
  '    Write-Output ("  root class=" + $root.Current.ClassName + " name=" + $root.Current.Name)',
  '    $all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
  '    Write-Output ("  descendants=" + $all.Count)',
  '  }',
  '}',
  '',
  '// все top-level окна процесса',
  '$cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $procs[0].Id)',
  '$tops = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)',
  'Write-Output ("top-level окон: " + $tops.Count)',
  'for ($i = 0; $i -lt $tops.Count; $i++) {',
  '  $w = $tops.Item($i)',
  '  $r = $w.Current.BoundingRectangle',
  '  Write-Output ("  [" + $i + "] class=" + $w.Current.ClassName + " name=" + $w.Current.Name + " rect=" + $r.ToString())',
  '}',
].join('\n');

try {
  console.log(ps(RAW));
} catch (e) {
  console.log('ошибка:', e.message.slice(0, 150));
}
