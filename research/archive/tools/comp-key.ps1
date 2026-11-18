# COMPRESSOR: открыть окно, поднять его, отправить клавиши в дил.
#
# Окно компрессора CompressorS1M1 — ОТДЕЛЬНОЕ top-level окно (не внутри главного).
# SendKeys уходит в foreground, поэтому окно надо поднимать через AttachThreadInput.
#
# Команды:
#   state                      -> JSON: open/hwnd/foreground/switch/gainAuto
#   open                       -> открыть окно (клик по MORE), если закрыто
#   press <Param> <Key> <N> <Ms> -> поднять, сфокусировать дил, послать клавишу N раз
#   toggle switch|gainauto     -> переключить TogglePattern напрямую

param(
  [Parameter(Position=0)][string]$Action = 'state',
  [Parameter(Position=1)][string]$Param = '',
  [Parameter(Position=2)][string]$Key = '{UP}',
  [Parameter(Position=3)][int]$Times = 1,
  [Parameter(Position=4)][int]$Delay = 90
)

Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class CW {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool f);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
}
'@
[CW]::SetProcessDPIAware() | Out-Null

$ErrorActionPreference = 'Stop'

function Get-Root {
  $p = Get-Process -Name "M Control Center" -ErrorAction Stop | Select-Object -First 1
  if ($p.MainWindowHandle -eq 0) { throw "MCC_NO_WINDOW" }
  return [System.Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)
}

function Get-CompWin {
  $cond = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ClassNameProperty, "CompressorS1M1")
  # 1) как top-level (обычно Qt не отдаёт так, но проверяем)
  $dr = [System.Windows.Automation.AutomationElement]::RootElement
  $w = $dr.FindFirst([System.Windows.Automation.TreeScope]::Children, $cond)
  if ($w -ne $null) { return $w }
  # 2) как потомок главного окна — рабочий путь на этой сборке Qt
  try {
    $root = Get-Root
    return $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
  } catch {
    return $null
  }
}

function Get-AidElement($root, $pattern) {
  $all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants,
    [System.Windows.Automation.Condition]::TrueCondition)
  for ($i = 0; $i -lt $all.Count; $i++) {
    $e = $all.Item($i)
    if ($e.Current.AutomationId -like $pattern) { return $e }
  }
  return $null
}

function Get-AidRegex($root, $regex) {
  $all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants,
    [System.Windows.Automation.Condition]::TrueCondition)
  for ($i = 0; $i -lt $all.Count; $i++) {
    $e = $all.Item($i)
    if ($e.Current.AutomationId -match $regex) { return $e }
  }
  return $null
}

function Show-CompWin($win) {
  $hwnd = [IntPtr]$win.Current.NativeWindowHandle
  $fg = [CW]::GetForegroundWindow()
  $pidFg = 0
  $tidFg = [CW]::GetWindowThreadProcessId($fg, [ref]$pidFg)
  $tidCur = [CW]::GetCurrentThreadId()
  [CW]::AttachThreadInput($tidCur, $tidFg, $true) | Out-Null
  [CW]::ShowWindow($hwnd, 5) | Out-Null
  [CW]::BringWindowToTop($hwnd) | Out-Null
  [CW]::SetForegroundWindow($hwnd) | Out-Null
  [CW]::AttachThreadInput($tidCur, $tidFg, $false) | Out-Null
  return $hwnd
}

function Get-Toggle($el) {
  if ($el -eq $null) { return 'none' }
  try {
    $tp = $el.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)
    return [string]$tp.Current.ToggleState
  } catch { return 'none' }
}

# ─────────────────────────── OPEN ───────────────────────────
if ($Action -eq 'open') {
  $win = Get-CompWin
  if ($win -ne $null) {
    Show-CompWin $win | Out-Null
    Write-Output "ALREADY_OPEN"
    exit 0
  }
  $root = Get-Root
  $more = Get-AidElement $root '*buttonMore*'
  if ($more -eq $null) { Write-Output "NO_MORE_BUTTON"; exit 1 }
  $r = $more.Current.BoundingRectangle
  $cx = [int]($r.X + $r.Width / 2)
  $cy = [int]($r.Y + $r.Height / 2)
  [CW]::SetCursorPos($cx, $cy) | Out-Null
  Start-Sleep -Milliseconds 250
  [CW]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero)
  Start-Sleep -Milliseconds 80
  [CW]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)
  Start-Sleep -Milliseconds 1200
  $win = Get-CompWin
  if ($win -eq $null) { Write-Output "OPEN_FAILED"; exit 1 }
  Show-CompWin $win | Out-Null
  Write-Output "OPENED"
  exit 0
}

# ─────────────────────────── STATE ───────────────────────────
if ($Action -eq 'state') {
  $root = Get-Root
  $win = Get-CompWin
  $open = ($win -ne $null)
  $hwnd = 0
  if ($open) { $hwnd = $win.Current.NativeWindowHandle }
  $fg = [CW]::GetForegroundWindow()
  $sw = 'none'
  $ga = 'none'
  if ($open) {
    $swEl = Get-AidElement $win '*widgetTop.Switch'
    $gaEl = Get-AidElement $win '*widget_5.GainAuto'
    $sw = Get-Toggle $swEl
    $ga = Get-Toggle $gaEl
  }
  $openS = 'false'
  if ($open) { $openS = 'true' }
  $json = [ordered]@{
    open       = $open
    hwnd       = $hwnd
    foreground = $fg.ToInt64()
    switch     = $sw
    gainAuto   = $ga
  }
  Write-Output ($json | ConvertTo-Json -Compress)
  exit 0
}

# ─────────────────────────── TOGGLE ───────────────────────────
if ($Action -eq 'toggle') {
  $win = Get-CompWin
  if ($win -eq $null) { Write-Output "NO_COMPWIN"; exit 1 }
  $pattern = if ($Param -eq 'switch') { '*widgetTop.Switch' } else { '*widget_5.GainAuto' }
  $el = Get-AidElement $win $pattern
  if ($el -eq $null) { Write-Output "NO_ELEMENT"; exit 1 }
  $tp = $el.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)
  $before = [string]$tp.Current.ToggleState
  $tp.Toggle()
  Start-Sleep -Milliseconds 700
  $tp2 = $el.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)
  Write-Output ("BEFORE={0} AFTER={1}" -f $before, [string]$tp2.Current.ToggleState)
  exit 0
}

# ─────────────────────────── CLOSE ───────────────────────────
if ($Action -eq 'close') {
  $win = Get-CompWin
  if ($win -eq $null) { Write-Output "ALREADY_CLOSED"; exit 0 }
  $btn = Get-AidRegex $win 'widgetTop\.buttonClose'
  if ($btn -eq $null) { Write-Output "NO_CLOSE_BUTTON"; exit 1 }
  $ip = $null
  try {
    $ip = $btn.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
    $ip.Invoke()
  } catch {
    Write-Output ("INVOKE_ERR " + $_)
    exit 1
  }
  Start-Sleep -Milliseconds 800
  $still = Get-CompWin
  $nowOpen = ($still -ne $null)
  Write-Output ("CLOSED open=" + $nowOpen)
  exit 0
}

# ─────────────────────────── PRESS ───────────────────────────
if ($Action -eq 'press') {
  if ($Param -eq '') { Write-Output "NO_PARAM"; exit 1 }
  $win = Get-CompWin
  if ($win -eq $null) { Write-Output "NO_COMPWIN"; exit 1 }

  $hwnd = Show-CompWin $win
  Start-Sleep -Milliseconds 300

  # ПРОВЕРКА: окно реально в фокусе, иначе SendKeys улетят в другое приложение
  $fg = [CW]::GetForegroundWindow()
  if ($fg -ne $hwnd) {
    # вторая попытка
    Show-CompWin $win | Out-Null
    Start-Sleep -Milliseconds 400
    $fg = [CW]::GetForegroundWindow()
    if ($fg -ne $hwnd) {
      Write-Output ("NOT_FOREGROUND fg=" + $fg + " want=" + $hwnd)
      exit 2
    }
  }

  $dial = Get-AidRegex $win ("\.Compressor\..*\." + $Param + "$")
  if ($dial -eq $null) {
    $dial = Get-AidRegex $win ("\." + $Param + "$")
  }
  if ($dial -eq $null) { Write-Output "NO_DIAL"; exit 1 }

  $dial.SetFocus()
  Start-Sleep -Milliseconds 220

  # ещё раз убеждаемся, что фокус там же
  $fg = [CW]::GetForegroundWindow()
  if ($fg -ne $hwnd) {
    Write-Output ("LOST_FOCUS fg=" + $fg)
    exit 2
  }

  for ($i = 0; $i -lt $Times; $i++) {
    [System.Windows.Forms.SendKeys]::SendWait($Key)
    Start-Sleep -Milliseconds $Delay
  }
  Write-Output ("SENT " + $Param + " " + $Key + " x" + $Times)
  exit 0
}

Write-Output "UNKNOWN_ACTION"
exit 1
