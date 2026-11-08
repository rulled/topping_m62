Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$p = Get-Process -Name "M Control Center" -ErrorAction Stop | Select-Object -First 1
$cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $p.Id)
$tops = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)
$root = $null
for ($i = 0; $i -lt $tops.Count; $i++) {
  if ($tops.Item($i).Current.ClassName -eq "MainWindow_M62") { $root = $tops.Item($i); break }
}
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
# берём комбобокс полосы 1
$e = $all.Item(21)
$exp = $null
if ($e.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$exp)) {
  ([System.Windows.Automation.ExpandCollapsePattern]$exp).Expand()
  Write-Output "EXPANDED"
  Start-Sleep -Milliseconds 900
  Write-Output ("state now = " + ([System.Windows.Automation.ExpandCollapsePattern]$exp).Current.ExpandCollapseState)
}
# ищем выпавший список в КОРНЕ (Qt кладёт его отдельным top-level окном)
$rc = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
for ($i=0; $i -lt $rc.Count; $i++) {
  $w = $rc.Item($i)
  if ($w.Current.ClassName -eq 'QComboBoxPrivateContainer') {
    Write-Output ("POPUP найдено, handle=" + $w.Current.NativeWindowHandle)
    $items = $w.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
    for ($k=0; $k -lt $items.Count; $k++) {
      $it = $items.Item($k)
      $r = $it.Current.BoundingRectangle
      $ip = $null
      $sel = $null
      $hasInvoke = $it.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$ip)
      $hasSel = $it.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$sel)
      $isSel = ''
      if ($hasSel) { $isSel = ([System.Windows.Automation.SelectionItemPattern]$sel).Current.IsSelected }
      Write-Output ("   [" + $k + "] " + $it.Current.ClassName + " name='" + $it.Current.Name + "' (" + [int]($r.X+$r.Width/2) + "," + [int]($r.Y+$r.Height/2) + ") invoke=" + $hasInvoke + " selItem=" + $hasSel + " selected=" + $isSel)
    }
  }
}
