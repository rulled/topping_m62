r"""ПРОВЕРКА ЦЕЛОСТНОСТИ ПРОШИВКИ В MCC: ЧТО ИМЕННО ПРОВЕРЯЕТСЯ.

══════════ ГЛАВНАЯ НАХОДКА ══════════

В MCC найдена строка:

    @0x2743ED  "File verification failed"

Рядом: Import, Workspace already exists, ItemChanged, RemoveItem,
RestoreDefault, NewItem.

⚠ ВАЖНО: судя по соседям, это ошибка ИМПОРТА WORKSPACE-файла, а НЕ
прошивки. Надо проверить контекст внимательнее, прежде чем делать
вывод.

Также найдено:
    0x26FC08  "Available version : V0.1.0"
              "Current version  : V0.0.0"
              "Download failed."
              "DFU failed. Please restart the device and try again."
              "DFU successful. Please restart the device."
    0x29CBC0  USBAudioAPI::getDFUBytesTotal
              USBAudioAPI::getDFUBytesCurrent
              USBAudioAPI::getDFUPercentageComplete
    0x29BA10  "Url is empty" | ".zip" | ".bin" | Expand-Archive

То есть процедура обновления:
  1. качает .zip по URL;
  2. распаковывает через PowerShell Expand-Archive;
  3. берёт оттуда .bin;
  4. шлёт через DFU-интерфейс, отслеживая прогресс.

══════════ ЧТО ПРОВЕРЯЕТ ЭТОТ СКРИПТ ══════════

1. Полный контекст строки "File verification failed" — к чему она.
2. Все строки вокруг DFU-процедуры (широкое окно).
3. Есть ли рядом имена хеш-функций (MD5/SHA) в ТОМ ЖЕ месте.
4. Ищем формат заголовка прошивки: первые 16 байт файла —
   11 af 7a c0 ad 4c 0c 98 13 6c f1 04. Если это хеш, он должен
   где-то в MCC фигурировать.

Запуск: python research/mcc-firmware-verify.py
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

MCC = Path(r"C:\Program Files\TOPPING Pro\M Control Center\M Control Center.exe")
FW = Path("research/firmware/M62_FW87.05.45.48.27/M62_FW87.05.45.48.27.bin")

# первые 16 байт прошивки — кандидаты в «магию» или хеш
FW_HEAD = bytes.fromhex("11af7ac0ad4c0c98136cf104")


def show_ctx(data: bytes, pos: int, before: int = 300, after: int = 500) -> None:
    s = max(0, pos - before)
    e = min(len(data), pos + after)
    chunk = data[s:e]
    print(f"  --- окно @0x{s:06X}..0x{e:06X} ---")
    for m in re.finditer(rb"[\x20-\x7e]{4,}", chunk):
        abs_pos = s + m.start()
        marker = " <--" if abs(abs_pos - pos) < 4 else ""
        print(f"    @0x{abs_pos:06X}  {m.group().decode('latin1')[:90]}{marker}")


def main() -> None:
    if not MCC.exists():
        sys.exit(f"нет файла: {MCC}")
    data = MCC.read_bytes()
    print("=" * 74)
    print("ПРОВЕРКА ЦЕЛОСТНОСТИ: ЧТО ИМЕННО ПРОВЕРЯЕТ MCC")
    print("=" * 74)

    # ─── 1. контекст "File verification failed" ───
    print("\n" + "-" * 74)
    print("1. «File verification failed» — к чему относится")
    print("-" * 74)
    for m in re.finditer(rb"File verification failed", data):
        show_ctx(data, m.start(), 400, 400)

    # ─── 2. широкий контекст DFU ───
    print("\n" + "-" * 74)
    print("2. ПРОЦЕДУРА ОБНОВЛЕНИЯ (широкое окно вокруг DFU)")
    print("-" * 74)
    seen = set()
    for m in re.finditer(rb"DFU failed|DFU successful", data):
        if m.start() in seen:
            continue
        seen.add(m.start())
        show_ctx(data, m.start(), 700, 700)
        print()

    # ─── 3. есть ли хеши рядом с прошивкой ───
    print("\n" + "-" * 74)
    print("3. ХЕШ-ФУНКЦИИ ВБЛИЗИ DFU (в радиусе 4000 байт)")
    print("-" * 74)
    dfu_positions = [m.start() for m in re.finditer(rb"DFU", data)]
    hash_pat = re.compile(rb"MD5|md5|SHA1|SHA256|sha256|CRC32|CRC16")
    found_near = False
    for dp in dfu_positions[:20]:
        for hm in hash_pat.finditer(data, max(0, dp - 4000), min(len(data), dp + 4000)):
            print(f"  DFU@0x{dp:06X} <-> hash@0x{hm.start():06X} "
                  f"({hm.group().decode()})  расстояние {abs(hm.start()-dp)}")
            found_near = True
    if not found_near:
        print("  хеш-функций рядом с DFU НЕ найдено")

    # ─── 4. ищем первые байты прошивки в MCC ───
    print("\n" + "-" * 74)
    print("4. ПЕРВЫЕ 16 БАЙТ ПРОШИВКИ — есть ли они в MCC")
    print("-" * 74)
    print(f"  ищем: {FW_HEAD.hex(' ')}")
    hits = []
    start = 0
    while True:
        i = data.find(FW_HEAD, start)
        if i < 0:
            break
        hits.append(i)
        start = i + 1
        if len(hits) > 10:
            break
    if hits:
        print(f"  НАЙДЕНО {len(hits)} раз: {[hex(h) for h in hits]}")
    else:
        print("  не найдено — значит это не хеш, зашитый в приложение")

    # ─── 5. ищем ПАРЫ байт из заголовка прошивки ───
    print("\n" + "-" * 74)
    print("5. ЧАСТИ ЗАГОЛОВКА ПРОШИВКИ В MCC (по 8 байт)")
    print("-" * 74)
    for off in range(0, 16, 8):
        part = FW_HEAD[off : off + 8]
        cnt = data.count(part)
        print(f"  {part.hex(' ')}  ->  встречается {cnt} раз")

    # ─── 6. строки процедуры обновления ───
    print("\n" + "-" * 74)
    print("6. СТРОКИ ПРОЦЕДУРЫ (поиск по шаблону)")
    print("-" * 74)
    patterns = [
        rb"[A-Za-z ]*download[A-Za-z ]*",
        rb"[A-Za-z ]*verif[A-Za-z ]*",
        rb"[A-Za-z ]*expand[A-Za-z ]*",
        rb"https?://[^\x00-\x20\"'<>]{10,}",
    ]
    for pat in patterns:
        print(f"\n  шаблон {pat.decode()[:40]}:")
        seen_s = set()
        for m in re.finditer(pat, data):
            s = m.group().decode("latin1").strip()
            if len(s) < 6 or s in seen_s:
                continue
            seen_s.add(s)
            print(f"    @0x{m.start():06X}  {s[:90]}")
            if len(seen_s) >= 10:
                break

    # ─── ВЫВОД ───
    print("\n" + "=" * 74)
    print("ВЫВОД")
    print("=" * 74)
    print("""
  Процедура обновления в MCC:
    1. скачивает .zip по URL;
    2. распаковывает PowerShell-ом (Expand-Archive);
    3. берёт .bin с именем M62_FW*.bin;
    4. передаёт через DFU с прогрессом (getDFUBytesTotal и др.).

  «File verification failed» по соседним строкам относится к ИМПОРТУ
  WORKSPACE (Import, Workspace already exists), а НЕ к прошивке.

  Проверки целостности ПРОШИВКИ в MCC по строкам не видно. Но это
  не значит, что её нет: она может быть в коде без строк, либо
  выполняться самой картой при приёме образа.

  ⚠ ПРАКТИЧЕСКИЙ ВЫВОД: модификация прошивки ОСТАЁТСЯ РИСКОВАННОЙ.
  Безопасного способа проверить, примет ли карта изменённый образ,
  нет: ошибка = кирпич (восстановление только через DFU, если он
  останется доступен).
""")


if __name__ == "__main__":
    main()
