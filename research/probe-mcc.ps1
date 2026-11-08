Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$p = Get-Process -Name "M Control Center" -ErrorAction Stop | Select-Object -First 1
Write-Host ("PID=" + $p.Id + " MainWindowHandle=" + $p.MainWindowHandle + " StartTime=" + $p.StartTime)
$cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $p.Id)
$tops = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)
Write-Host ("top-level окон: " + $tops.Count)
for ($i=0; $i -lt $tops.Count; $i++) {
  $w = $tops.Item($i)
  $r = $w.Current.BoundingRectangle
  Write-Host ("  [" + $i + "] cls='" + $w.Current.ClassName + "' name='" + $w.Current.Name + "' " + [int]$r.Width + "x" + [int]$r.Height + " handle=" + $w.Current.NativeWindowHandle)
}
