Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$popupCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ClassNameProperty, 'QComboBoxPrivateContainer')
$popup = [System.Windows.Automation.AutomationElement]::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children, $popupCond)
if ($null -eq $popup) { Write-Output "NO_POPUP"; exit 0 }
$items = $popup.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
for ($k = 0; $k -lt $items.Count; $k++) {
  $it = $items.Item($k)
  $r = $it.Current.BoundingRectangle
  $cx = [int]($r.X + $r.Width/2)
  $cy = [int]($r.Y + $r.Height/2)
  Write-Output ("ITEM name='" + $it.Current.Name + "' x=" + $cx + " y=" + $cy + " w=" + [int]$r.Width + " h=" + [int]$r.Height)
}
