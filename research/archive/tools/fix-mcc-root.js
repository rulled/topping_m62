/**
 * ИСПРАВЛЕНИЕ: закрыть выпадающий список и найти ПРАВИЛЬНОЕ главное окно.
 *
 * Проблема: Get-MccRoot брал MainWindowHandle, а он указывает на
 * QComboBoxPrivateContainer (открытый выпадающий список), а не на MainWindow_M62.
 */
import { ps, PRELUDE } from './uia.js';
import { execFileSync } from 'node:child_process';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1) закрываем все выпадающие списки через Escape
console.log('=== закрываю выпадающие списки (Escape x3) ===');
const ESC = String.raw`
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait("{ESC}")
Start-Sleep -Milliseconds 300
[System.Windows.Forms.SendKeys]::SendWait("{ESC}")
Start-Sleep -Milliseconds 300
[System.Windows.Forms.SendKeys]::SendWait("{ESC}")
Write-Output "esc sent"
`;
try { console.log('  ' + execFileSync('powershell.exe', ['-NoProfile', '-Command', ESC], { encoding: 'utf8' }).trim()); } catch { /* */ }
await sleep(1000);

// 2) находим ПРАВИЛЬНОЕ окно по классу MainWindow_M62
console.log('\n=== ищу окно по классу MainWindow_M62 ===');
const FIND = PRELUDE + [
  '$procs = Get-Process -Name "M Control Center" -ErrorAction SilentlyContinue',
  '$cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $procs[0].Id)',
  '$tops = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)',
  'for ($i = 0; $i -lt $tops.Count; $i++) {',
  '  $w = $tops.Item($i)',
  '  if ($w.Current.ClassName -eq "MainWindow_M62") {',
  '    Write-Output ("FOUND idx=" + $i + " name=" + $w.Current.Name)',
  '    $all = $w.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
  '    Write-Output ("descendants=" + $all.Count)',
  '  }',
  '}',
].join('\n');
try { console.log(ps(FIND)); } catch (e) { console.log('  ошибка:', e.message.slice(0, 100)); }

// 3) проверяем через dumpTree
const { dumpTree } = await import('./uia.js');
const { items } = dumpTree();
console.log(`\n=== dumpTree (текущий Get-MccRoot) ===`);
console.log(`  элементов: ${items.length}`);

const in1 = items.find((x) => (x.name || '').trim() === 'IN1');
console.log(`  подпись IN1: ${in1 ? `(${in1.lx},${in1.ly})` : 'НЕ НАЙДЕНА'}`);
