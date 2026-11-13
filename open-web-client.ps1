#!/usr/bin/env pwsh
# ПРОВЕРКА ВЕБ-КЛИЕНТА В БРАУЗЕРЕ
#
# ЗАПУСКАТЬ В ОБЫЧНОМ (НЕ headless) БРАУЗЕРЕ.
#
# ═══ ЧТО ЭТО ═══
#
# Открывает наш веб-клиент и показывает, что проверить руками.
# WebHID требует видимого окна и разрешения пользователя, поэтому
# headless-режим не подходит: в нём `navigator.hid` отсутствует.
#
# ═══ ЧТО ДЕЛАЕТ ═══
#
#   1. Проверяет, что сервер отвечает.
#   2. Находит Chrome или Edge.
#   3. Открывает страницу http://127.0.0.1:<порт>/
#   4. Печатает чек-лист.
#
# Запуск:
#   .\open-web-client.ps1
#   .\open-web-client.ps1 -Port 8900

param(
    [int]$Port = 8898
)

$ErrorActionPreference = 'Stop'

Write-Host '=== ВЕБ-КЛИЕНТ M62 ===' -ForegroundColor Cyan
Write-Host ''

# --- 1. сервер ---
Write-Host 'проверяю сервер...'
$alive = $false
try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/health" -UseBasicParsing -TimeoutSec 5
    $alive = $r.StatusCode -eq 200
} catch {
    $alive = $false
}

if ($alive) {
    Write-Host "  сервер отвечает на порту $Port" -ForegroundColor Green
} else {
    Write-Host "  СЕРВЕР НЕ ОТВЕЧАЕТ на порту $Port" -ForegroundColor Red
    Write-Host ''
    Write-Host '  Запустите его в другом окне:' -ForegroundColor Yellow
    Write-Host "    `$env:M62_PORT='$Port'; node src/server.js"
    Write-Host ''
    Write-Host '  Без сервера страница всё равно откроется, но понадобится' -ForegroundColor Yellow
    Write-Host '  раздать её иначе (например, python -m http.server из папки web).'
    Write-Host '  ВАЖНО: WebHID требует https или localhost.'
}

# --- 2. браузер ---
$candidates = @(
    'C:\Program Files\Google\Chrome\Application\chrome.exe',
    'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
    'C:\Program Files\Microsoft\Edge\Application\msedge.exe',
    'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
)

$browser = $null
foreach ($c in $candidates) {
    if (Test-Path $c) {
        $browser = $c
        break
    }
}

if (-not $browser) {
    Write-Host ''
    Write-Host '  БРАУЗЕР НЕ НАЙДЕН (нужен Chrome или Edge)' -ForegroundColor Red
    Write-Host '  Firefox и Safari WebHID не поддерживают.'
    exit 1
}

Write-Host "  браузер: $(Split-Path $browser -Leaf)"

$url = "http://127.0.0.1:$Port/"
Write-Host ''
Write-Host "открываю $url" -ForegroundColor Cyan
Start-Process $browser $url

Write-Host ''
Write-Host '=== ЧЕК-ЛИСТ ===' -ForegroundColor Cyan
Write-Host @'
  1. Страница открылась, вверху «не подключено».
  2. Нажмите «Подключить».
  3. Браузер покажет список устройств — выберите M62.
     (Если список пуст: карта не воткнута, либо её уже занял
      M Control Center — закройте MCC и повторите.)
  4. После выбора:
       - статус станет «подключено» (зелёный),
       - через ~6 секунд заполнятся карточки: выходы, входы,
         эффекты, EQ,
       - «адресов получено» станет больше 80.
  5. Воткните наушники — «наушники подключены» должно стать «да».
  6. Внизу лог: там видно handshake, число адресов и ошибки.

  ЕСЛИ ЧТО-ТО НЕ ТАК — скопируйте содержимое лога (серый блок
  внизу страницы) и пришлите: по нему видно, на каком шаге встало.
'@

Write-Host ''
Write-Host 'ВАЖНО: страница не отправляет данные карты в интернет.' -ForegroundColor Gray
Write-Host 'Всё общение с устройством идёт через WebHID внутри браузера.' -ForegroundColor Gray
