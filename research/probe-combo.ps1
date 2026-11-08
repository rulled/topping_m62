Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$p = Get-Process -Name "M Control Center" -ErrorAction Stop | Select-Object -First 1
$cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $p.Id)
$tops = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)
$root = $null
for ($i = 0; $i -lt $tops.Count; $i++) {
  if ($tops.Item($i).Current.ClassName -eq "MainWindow_M62") { $root = $tops.Item($i); break }
}
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
for ($i=0; $i -lt $all.Count; $i++) {
  $e = $all.Item($i)
  if ($e.Current.ClassName -ne 'ComboBoxS1M3') { continue }
  if ($e.Current.AutomationId -notlike '*EqWidgetIem.ComboBoxS1M3') { continue }
  $r = $e.Current.BoundingRectangle
  $sel = $null
  if ($e.TryGetCurrentPattern([System.Windows.Automation.SelectionPattern]::Pattern, [ref]$sel)) {
    $sp = [System.Windows.Automation.SelectionPattern]$sel
    $cur = $sp.Current.GetSelection()
    $names = @()
    foreach ($c in $cur) { $names += $c.Current.Name }
    Write-Output ("[" + $i + "] SelectionPattern OK, выбрано: " + ($names -join '|'))
  } else { Write-Output ("[" + $i + "] NO SelectionPattern") }
  $exp = $null
  if ($e.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$exp)) {
    Write-Output ("     ExpandState=" + ([System.Windows.Automation.ExpandCollapsePattern]$exp).Current.ExpandCollapseState)
  }
}
