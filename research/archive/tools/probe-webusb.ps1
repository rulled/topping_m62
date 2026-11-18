# МОЖНО ЛИ ВЗЯТЬ M62 ЧЕРЕЗ WebUSB ВМЕСТО WebHID
#
# ═══ ЗАЧЕМ ═══
#
# У M62 нестандартный HID Usage = 0x00. Из-за этого фильтр WebHID
# по usage не работает, а в диалоге выбора Chrome показывает
# устройство без описания. WebUSB захватывает интерфейс напрямую
# и на usage pages не смотрит.
#
# ═══ ЧТО ПРОВЕРЯЕТСЯ ═══
#
# WebUSB требует, чтобы у интерфейса был драйвер WinUSB (или
# libusb). На Windows это значит:
#   - либо интерфейс не занят системным драйвером (WinUSB ставится
#     через INF или Zadig),
#   - либо у устройства есть дескриптор совместимости MS OS 2.0,
#     который сам просит WinUSB.
#
# ЗАМЕНА ДРАЙВЕРА НА ИНТЕРФЕЙСЕ 0 (аудио) СЛОМАЕТ ЗВУК — там
# проприетарный ToppingProUsbAudio. Значит WebUSB применим только
# к интерфейсу 4, если его можно отдать WinUSB, не сломав HID.
#
# Запуск: pwsh -File src/tools/probe-webusb.ps1

$ErrorActionPreference = 'Continue'

$VIDPID = '152A&PID_875C'

Write-Host '=== 1. ВСЕ ИНТЕРФЕЙСЫ УСТРОЙСТВА ===' -ForegroundColor Cyan
$nodes = Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue |
    Where-Object { $_.InstanceId -like "*$VIDPID*" }

foreach ($n in $nodes) {
    $mi = if ($n.InstanceId -match 'MI_(\d+)') { $Matches[1] } else { '00' }
    $svc = '?'
    try {
        $p = Get-PnpDeviceProperty -InstanceId $n.InstanceId -ErrorAction SilentlyContinue |
            Where-Object { $_.KeyName -eq 'DEVPKEY_Device_Service' }
        if ($p) { $svc = $p.Data }
    } catch { }
    Write-Host ("  MI_{0}  class={1,-12} service={2,-26} {3}" -f $mi, $n.Class, $svc, $n.FriendlyName)
}

Write-Host ''
Write-Host '=== 2. ДРАЙВЕРЫ ПО ИНТЕРФЕЙСАМ ===' -ForegroundColor Cyan
foreach ($n in $nodes) {
    $mi = if ($n.InstanceId -match 'MI_(\d+)') { $Matches[1] } else { '00' }
    $props = Get-PnpDeviceProperty -InstanceId $n.InstanceId -ErrorAction SilentlyContinue |
        Where-Object { $_.KeyName -in @('DEVPKEY_Device_Service', 'DEVPKEY_Device_DriverDesc', 'DEVPKEY_Device_CompatibleIds') }
    Write-Host "  MI_$mi"
    foreach ($p in $props) {
        $v = if ($p.Data -is [array]) { $p.Data -join ', ' } else { $p.Data }
        Write-Host ("    {0,-28} {1}" -f ($p.KeyName -replace 'DEVPKEY_Device_', ''), $v)
    }
}

Write-Host ''
Write-Host '=== 3. ВЫВОД ===' -ForegroundColor Cyan
Write-Host @'
  Смотрите service у MI_04 (это HID с нашим протоколом).

  Если service = HIDCLASS:
    Интерфейс занят системным HID-драйвером. WebUSB его не возьмёт
    без замены драйвера на WinUSB. Замена сломает HID (а значит
    и WebHID, и работу MCC). НЕ ДЕЛАТЬ на рабочей машине.

  Если service пустой или WinUSB:
    WebUSB возможен.

  MI_00 — это аудио с проприетарным ToppingProUsbAudio_sc.
  НЕ ТРОГАТЬ: замена драйвера убьёт звук и, вероятно, потребует
  переустановки драйверов Topping.

  ИТОГ для решения:
    если HIDCLASS — WebUSB не даёт выигрыша без порчи устройства,
    и WebHID остаётся единственным браузерным путём.
'@

Write-Host ''
Write-Host '=== 4. ДЕСКРИПТОР СОВМЕСТИМОСТИ MS OS (если есть) ===' -ForegroundColor Cyan
Write-Host @'
  WinUSB может ставиться автоматически, если устройство просит его
  через дескриптор совместимости MS OS 2.0 (строка "WINUSB" в
  CompatibleIds).

  Если в разделе 2 у MI_04 в CompatibleIds есть USB\MS_COMP_WINUSB —
  WebUSB заработает без замены драйвера. Если нет — не заработает.
'@
