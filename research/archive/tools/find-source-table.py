r"""Таблица источников в бинарнике MCC — независимая проверка.

══════════ ЗАЧЕМ ══════════

Коды источников были выведены по последовательности (9 точек из 17).
Есть два независимых источника истины:

  1. mainline-патч drivers/hid/hid-topping-m62.c (VID 0x152a / PID 0x875c)
     — таблица topping_source_value[] с дырой на 4/5.
  2. Сам M Control Center — он эту же таблицу где-то держит.

Если обе совпадут — вопрос закрыт без единого нового захвата.

══════════ ЧТО ДЕЛАЕТ ══════════

Ищет в .rdata MCC строковые литералы источников и печатает их
окрестности, а также ищет байтовую последовательность кодов
(0,1,2,3,6,7,8,...) рядом с ними.

Запуск: python src/tools/find-source-table.py
"""

from __future__ import annotations

import re
from pathlib import Path

EXE = Path(r"C:\Program Files\TOPPING Pro\M Control Center\M Control Center.exe")

NAMES = [
    "Unknown", "Mix A", "Mix B", "Mix C", "IN 1", "IN 2", "IN 1+2",
    "AUX", "BT", "OTG IN", "Playback 1/2", "Playback 3/4",
    "Playback 5/6", "Playback 7/8", "Playback 9/10", "FX",
]

DRIVER_CODES = [0, 1, 2, 3, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]


def printable(blob: bytes, start: int, end: int) -> str:
    seg = blob[max(0, start) : min(len(blob), end)]
    return "".join(chr(b) if 32 <= b < 127 else "|" for b in seg)


def main() -> None:
    if not EXE.exists():
        raise SystemExit(f"нет файла: {EXE}")
    blob = EXE.read_bytes()
    print(f"файл: {EXE.name}, {len(blob) / 1024 / 1024:.1f} МБ\n")

    # --- 1. все имена источников ---
    print("=" * 72)
    print("1. ГДЕ ЛЕЖАТ ИМЕНА ИСТОЧНИКОВ")
    print("=" * 72)
    pos: dict[str, list[int]] = {}
    for name in NAMES:
        needle = name.encode("ascii") + b"\x00"
        hits = [m.start() for m in re.finditer(re.escape(needle), blob)]
        pos[name] = hits
        where = ", ".join(str(h) for h in hits[:6]) or "нет"
        print(f"  {name:<14} {len(hits):>2} вхожд.  {where}")

    # --- 2. кластер: все 10 Playback/AUX/BT рядом = таблица ---
    print("\n" + "=" * 72)
    print("2. КЛАСТЕР ИМЁН (кандидат в таблицу источников)")
    print("=" * 72)

    anchors = pos.get("Playback 9/10", [])
    if not anchors:
        print("  'Playback 9/10' не найден — таблица, вероятно, собрана из Qt-ресурсов")
    for a in anchors:
        print(f"\n  окрестности {a}:")
        print("  " + printable(blob, a - 420, a + 120))

    # --- 3. последовательность кодов ---
    print("\n" + "=" * 72)
    print("3. ПОИСК БАЙТОВОЙ ТАБЛИЦЫ КОДОВ")
    print("=" * 72)

    as_bytes = bytes(DRIVER_CODES)
    hits = [m.start() for m in re.finditer(re.escape(as_bytes), blob)]
    print(f"  последовательность {list(as_bytes)}")
    print(f"  найдено вхождений: {len(hits)} -> {hits[:8]}")

    # варианты: u8, u16, u32
    for width, label in ((2, "u16"), (4, "u32")):
        variant = b"".join(c.to_bytes(width, "little") for c in DRIVER_CODES)
        h2 = [m.start() for m in re.finditer(re.escape(variant), blob)]
        print(f"  как {label}: {len(h2)} -> {h2[:8]}")

    # урезанная последовательность (без Unknown) — вдруг её и держит MCC
    tail = bytes(DRIVER_CODES[1:])
    h3 = [m.start() for m in re.finditer(re.escape(tail), blob)]
    print(f"  без нуля {list(tail)}: {len(h3)} -> {h3[:8]}")

    # --- 4. вывод ---
    print("\n" + "=" * 72)
    print("4. ВЫВОД")
    print("=" * 72)
    if hits:
        print("  Таблица кодов найдена в бинарнике — можно ставить без захвата.")
    else:
        print("  Таблицы кодов в виде байтов нет: MCC держит соответствие")
        print("  name -> code иначе (например, вычисляет или берёт из индекса).")
        print("  Значит опираться надо на патч драйвера.")


if __name__ == "__main__":
    main()
