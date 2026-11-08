# ЗАКРЫТЬ КАРТУ ИСТОЧНИКОВ МИКШЕРА — один запуск.
#
# ЗАПУСКАТЬ ОТ АДМИНИСТРАТОРА.
#
# ═══ ИДЕЯ ═══
#
# Известно: микшер это 10 групп x 20 свойств, пары L/R, 5 микс-шин.
# Неизвестно: какой номер свойства = IN / AUX / BT / PB12 ...
#
# Решение в один проход: присвоить КАЖДОМУ источнику УНИКАЛЬНОЕ значение
# в одном миксе. Тогда в bulk push каждое свойство получит своё число,
# и соответствие видно напрямую, без перебора.
#
#   Mix B:  IN12=-11  AUX=-12  BT=-13  FX=-14  PB12=-15
#           PB34=-16  PB56=-17  PB78=-18  PB910=-19
#   Mix C:  IN12=-21  AUX=-22  BT=-23
#
# Mix C служит перекрёстной проверкой: IN, AUX и BT там тоже есть,
# но с другими значениями. Если карта верна, они попадут в те же
# свойства, что и в Mix B.
#
# ═══ ПОСЛЕДОВАТЕЛЬНОСТЬ ═══
#
#   1. закрыть MCC (иначе перезапишет INI своей памятью)
#   2. бэкап INI, вписать уникальные значения
#   3. включить захват
#   4. запустить MCC -> он прочитает INI и отправит bulk push
#   5. подождать, остановить захват
#   6. ВОССТАНОВИТЬ INI из бэкапа
#   7. разобрать захват
#
# ═══ БЕЗОПАСНОСТЬ ═══
#
# Все значения отрицательные (тише unity), HP и OTG отключены.
# INI восстанавливается из бэкапа в конце автоматически.

$ErrorActionPreference = 'Stop'

# ═══ КАКОЙ ФАЙЛ ПРАВИТЬ ═══
#
# ВАЖНО (первый запуск провалился именно на этом): MCC хранит состояние
# не в M62_Live_main.ini, а в том файле, который указан в реестре:
#
#   HKCU\Software\TOPPING\TOPPING Professional Control Center\M62
#       M62_Live_Workspace = main2
#
# То есть активный файл — M62_Live_main2.ini. Первый запуск правил
# _main.ini, MCC его не прочитал, и в bulk push ушли исходные значения.
#
# Теперь имя workspace берётся из реестра, а не угадывается.

$WS_ROOT  = 'C:\Program Files\TOPPING Pro\M Control Center\Workspace\M62\Live'
$REG_KEY  = 'HKCU:\Software\TOPPING\TOPPING Professional Control Center\M62'

$wsName = $null
try {
    $wsName = (Get-ItemProperty -Path $REG_KEY -Name 'M62_Live_Workspace' -ErrorAction Stop).M62_Live_Workspace
} catch { }

if (-not $wsName) {
    Write-Host '  Не смог прочитать M62_Live_Workspace из реестра.' -ForegroundColor Red
    Write-Host "  Проверь ключ $REG_KEY вручную." -ForegroundColor Red
    exit 1
}

$INI = Join-Path $WS_ROOT "M62_Live_$wsName.ini"
if (-not (Test-Path $INI)) {
    Write-Host "  Файл не найден: $INI" -ForegroundColor Red
    exit 1
}

$BAK      = "$INI.bak-srccheck"
$ROOT_HUB = '\\.\USBPcap1'
$OUT_FILE = Join-Path $PSScriptRoot 'research\mixer-sources.pcap'
$MCC_EXE  = 'C:\Program Files\TOPPING Pro\M Control Center\M Control Center.exe'

function Test-Admin {
    (New-Object Security.Principal.WindowsPrincipal(
        [Security.Principal.WindowsIdentity]::GetCurrent()
    )).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

Write-Host '=== 1. проверки ===' -ForegroundColor Cyan
if (-not (Test-Admin)) {
    Write-Host '  Нужны права администратора.' -ForegroundColor Red
    exit 1
}
Write-Host '  администратор: да'

$stale = Get-Process USBPcapCMD -ErrorAction SilentlyContinue
if ($stale) {
    Write-Host "  зависший USBPcapCMD: убиваю PID $($stale.Id -join ', ')"
    foreach ($p in $stale) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Seconds 2
}

$m62 = Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue |
    Where-Object { $_.InstanceId -like 'USB\VID_152A&PID_875C\*' }
if (-not $m62) { Write-Host '  M62 не найден.' -ForegroundColor Red; exit 1 }
Write-Host '  M62: найден'

Write-Host ''
Write-Host '=== 2. закрываем MCC ===' -ForegroundColor Cyan
Get-Process -Name 'M Control Center' -ErrorAction SilentlyContinue |
    ForEach-Object { $_.CloseMainWindow() | Out-Null }
Start-Sleep -Seconds 3
Get-Process -Name 'M Control Center' -ErrorAction SilentlyContinue |
    ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 3
$still = (Get-Process -Name 'M Control Center' -ErrorAction SilentlyContinue | Measure-Object).Count
if ($still -gt 0) {
    Write-Host '  MCC не закрылся. Закрой вручную (трей -> Выход) и повтори.' -ForegroundColor Red
    exit 1
}
Write-Host '  закрыт'

Write-Host ''
Write-Host '=== 3. бэкап INI и правка ===' -ForegroundColor Cyan
Write-Host "  активный workspace: $wsName"
Write-Host "  файл: $INI"
Copy-Item $INI $BAK -Force
Write-Host "  бэкап: $BAK"

# Значения: уникальные для каждого источника.
# ВАЖНО: INI без BOM, кодировка UTF-8. Читаем и пишем через .NET,
# чтобы не получить другой BOM (PowerShell Set-Content ломает файл).
#
# OTGIN в первом прогоне не участвовал — поэтому остался неопределённым.
# Теперь включён: -24 дБ, отдельно от серии -11..-19.
$MAP_B = [ordered]@{
    'Mixer_IN12'  = -11
    'Mixer_AUX'   = -12
    'Mixer_BT'    = -13
    'Mixer_FX'    = -14
    'Mixer_PB12'  = -15
    'Mixer_PB34'  = -16
    'Mixer_PB56'  = -17
    'Mixer_PB78'  = -18
    'Mixer_PB910' = -19
    'Mixer_OTGIN' = -24
}
$MAP_C = [ordered]@{
    'Mixer_IN12' = -21
    'Mixer_AUX'  = -22
    'Mixer_BT'   = -23
}

$text = [System.IO.File]::ReadAllText($INI)
$lines = $text -split "`r?`n"
$cur = $null
$changed = 0
for ($i = 0; $i -lt $lines.Count; $i++) {
    $t = $lines[$i].Trim()
    if ($t.StartsWith('[')) { $cur = $t.Substring(1, $t.Length - 2); continue }
    if (-not $cur) { continue }

    if ($MAP_B.Contains($cur) -and $t.StartsWith('MixB_GAIN=')) {
        $lines[$i] = "MixB_GAIN=$($MAP_B[$cur])"
        $changed++
        continue
    }
    if ($MAP_C.Contains($cur) -and $t.StartsWith('MixC_GAIN=')) {
        $lines[$i] = "MixC_GAIN=$($MAP_C[$cur])"
        $changed++
        continue
    }
}
$EXPECTED = 13   # Mix B: 10 источников + Mix C: 3
if ($changed -ne $EXPECTED) {
    Write-Host "  ОШИБКА: изменено $changed строк, ожидалось $EXPECTED" -ForegroundColor Red
    Copy-Item $BAK $INI -Force
    exit 1
}
[System.IO.File]::WriteAllText($INI, ($lines -join "`r`n"), (New-Object System.Text.UTF8Encoding($false)))
Write-Host "  вписано $changed значений (Mix B: -11..-19, Mix C: -21..-23)"

Write-Host ''
Write-Host '=== 4. захват ===' -ForegroundColor Cyan
if (Test-Path $OUT_FILE) { Remove-Item $OUT_FILE -Force }

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = 'C:\Program Files\USBPcap\USBPcapCMD.exe'
$psi.Arguments = "-d $ROOT_HUB -o `"$OUT_FILE`" --inject-descriptors -A"
$psi.UseShellExecute = $false
$psi.RedirectStandardInput = $true
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true

$proc = [System.Diagnostics.Process]::Start($psi)
Start-Sleep -Seconds 3
if ($proc.HasExited) {
    Write-Host "  USBPcapCMD упал: $($proc.StandardError.ReadToEnd())" -ForegroundColor Red
    Copy-Item $BAK $INI -Force
    Write-Host '  INI восстановлен.' -ForegroundColor Yellow
    exit 1
}
Write-Host '  захват идёт'

Write-Host ''
Write-Host '=== 5. запускаем MCC (прочитает INI и отправит bulk push) ===' -ForegroundColor Cyan
Start-Process $MCC_EXE
Start-Sleep -Seconds 25
Write-Host '  MCC загрузился'

Write-Host ''
Write-Host '=== 6. останавливаем захват ===' -ForegroundColor Cyan
Start-Sleep -Seconds 3
try { $proc.StandardInput.WriteLine(); $proc.StandardInput.Flush() } catch { }
Start-Sleep -Seconds 2
if (-not $proc.HasExited) { try { Stop-Process -Id $proc.Id -Force } catch { } }
Start-Sleep -Seconds 1

Write-Host ''
Write-Host '=== 7. восстанавливаем INI ===' -ForegroundColor Cyan
# Сначала закрыть MCC, иначе он перезапишет восстановленный файл.
Get-Process -Name 'M Control Center' -ErrorAction SilentlyContinue |
    ForEach-Object { $_.CloseMainWindow() | Out-Null }
Start-Sleep -Seconds 3
Get-Process -Name 'M Control Center' -ErrorAction SilentlyContinue |
    ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2
Copy-Item $BAK $INI -Force
Write-Host '  INI восстановлен из бэкапа'

Write-Host ''
Write-Host '=== 8. разбор ===' -ForegroundColor Cyan
if (-not (Test-Path $OUT_FILE)) {
    Write-Host '  файл не создан' -ForegroundColor Red
    exit 1
}
Write-Host ("  размер: {0:N0} байт" -f (Get-Item $OUT_FILE).Length)

& python (Join-Path $PSScriptRoot 'src\tools\map-sources.py') $OUT_FILE 6

Write-Host ''
Write-Host 'готово. INI восстановлен.' -ForegroundColor Green
