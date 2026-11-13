r"""СТРУКТУРА КОНТЕЙНЕРА ПРОШИВКИ M62.

══════════ ЧТО УЖЕ ИЗВЕСТНО ══════════

Из research/NOTES.md §5:
  • файл 1 216 512 байт (0x129000);
  • «не исполняемый код» — таблицы коэффициентов, карты блоков,
    калибровочные последовательности;
  • теги протокола (0x91, 0x93 …) в файле не найдены (77 проверено);
  • сжатия нет (проверены deflate/gzip — только STORED-блоки).

══════════ ЧТО ДЕЛАЕТ ЭТОТ СКРИПТ ══════════

Не повторяет прошлые проверки, а смотрит СТРУКТУРУ:
  1. Заголовок: первые 512 байт как массив 32-битных слов —
     ищем счётчики и пары (смещение, размер).
  2. Проверяет гипотезу «таблица записей»: если в начале есть
     N, за которым идут N пар (offset, size), и offset+size
     попадают внутрь файла — это каталог.
  3. Карта энтропии по 4 КБ: где данные, где нули, где плотные блоки.
  4. Поиск повторяющихся структур: одинаковая длина записи.

Запуск: python research/analyze-firmware-structure.py
"""

from __future__ import annotations

import struct
import sys
from collections import Counter
from pathlib import Path

FW = Path("research/firmware/M62_FW87.05.45.48.27/M62_FW87.05.45.48.27.bin")


def entropy(block: bytes) -> float:
    if not block:
        return 0.0
    counts = Counter(block)
    total = len(block)
    import math

    return -sum((c / total) * math.log2(c / total) for c in counts.values())


def main() -> None:
    if not FW.exists():
        sys.exit(f"нет файла: {FW}")
    data = FW.read_bytes()
    print("=" * 74)
    print(f"ПРОШИВКА M62: {FW.name}")
    print("=" * 74)
    print(f"размер: {len(data)} байт (0x{len(data):X})")

    # ─── 1. заголовок как 32-битные слова ───
    print("\n" + "-" * 74)
    print("ЗАГОЛОВОК: первые 32 слова (little-endian)")
    print("-" * 74)
    words = struct.unpack_from("<32I", data, 0)
    for i, w in enumerate(words):
        note = ""
        if 0 < w < len(data):
            note = "  <- в пределах файла"
        print(f"  [{i:2}] 0x{i*4:03X}  0x{w:08X}  {w:10}{note}")

    # ─── 2. гипотеза «каталог записей» ───
    print("\n" + "-" * 74)
    print("ГИПОТЕЗА: каталог пар (смещение, размер)")
    print("-" * 74)
    found_any = False
    for start in (8, 12, 16, 20, 24):
        count = struct.unpack_from("<I", data, start)[0]
        if not (1 <= count <= 4096):
            continue
        # пробуем прочитать count пар по 8 байт
        pairs_at = start + 4
        if pairs_at + count * 8 > len(data):
            continue
        ok = 0
        for k in range(count):
            off, size = struct.unpack_from("<II", data, pairs_at + k * 8)
            if 0 < off < len(data) and 0 < size <= len(data) and off + size <= len(data):
                ok += 1
        if ok >= count * 0.9:
            print(f"  старт {start}: счётчик={count}, валидных пар {ok}/{count}  <-- КАТАЛОГ")
            found_any = True
            for k in range(min(count, 12)):
                off, size = struct.unpack_from("<II", data, pairs_at + k * 8)
                print(f"    запись {k}: offset=0x{off:06X} size=0x{size:04X} ({size})")
        else:
            print(f"  старт {start}: счётчик={count}, валидных пар {ok}/{count}")

    if not found_any:
        print("  каталог пар не найден — структура иная")

    # ─── 3. карта энтропии ───
    print("\n" + "-" * 74)
    print("КАРТА ЭНТРОПИИ (блоки по 4 КБ)")
    print("-" * 74)
    BLK = 4096
    blocks = []
    for off in range(0, len(data), BLK):
        chunk = data[off : off + BLK]
        blocks.append((off, entropy(chunk), chunk))

    # сгруппировать по характеру
    kinds = {"нули": [], "разреженные": [], "обычные": [], "плотные": []}
    for off, e, chunk in blocks:
        zeros = chunk.count(0) / len(chunk)
        if zeros > 0.95:
            kinds["нули"].append((off, e, zeros))
        elif e < 3.0:
            kinds["разреженные"].append((off, e, zeros))
        elif e < 7.0:
            kinds["обычные"].append((off, e, zeros))
        else:
            kinds["плотные"].append((off, e, zeros))

    total = len(blocks)
    print(f"  всего блоков: {total} (по {BLK} байт)")
    for name, lst in kinds.items():
        pct = len(lst) / total * 100
        print(f"  {name:<12} {len(lst):4} блоков  {pct:5.1f}%")
        if lst and len(lst) <= 8:
            for off, e, z in lst:
                print(f"      @0x{off:06X}  H={e:4.2f}  нулей={z*100:5.1f}%")

    # ─── 4. самое плотное место ───
    print("\n" + "-" * 74)
    print("САМЫЕ ПЛОТНЫЕ БЛОКИ (высокая энтропия = сжатые/шифрованные данные)")
    print("-" * 74)
    densest = sorted(blocks, key=lambda x: -entropy(x[2]))[:8]
    for off, e, chunk in densest:
        head = chunk[:24].hex(" ")
        print(f"  @0x{off:06X}  H={e:5.3f}  {head}")

    # ─── 5. ищем сигнатуры ───
    print("\n" + "-" * 74)
    print("СИГНАТУРЫ")
    print("-" * 74)
    sigs = {
        "0x22 0x33 (кадр M62)": b"\x22\x33",
        "0x66 0x77 (хвост кадра)": b"\x66\x77",
        "ELF": b"\x7fELF",
        "ZIP/PK": b"PK\x03\x04",
        "gzip": b"\x1f\x8b",
        "Topping (текст)": b"Topping",
        "TOPPING": b"TOPPING",
        "M62 (текст)": b"M62",
        "V87": b"V87",
        "$VER": b"$VER",
        "AMD/Intel jmp": b"\xff\x25",
        "ARM vector table": b"\x00\x00\xa0\xe1",
    }
    for name, pat in sigs.items():
        positions = []
        start = 0
        while len(positions) < 6:
            i = data.find(pat, start)
            if i < 0:
                break
            positions.append(i)
            start = i + 1
        if positions:
            print(f"  {name:<28} найдено {len(positions)}+  @ {[hex(p) for p in positions[:6]]}")
        else:
            print(f"  {name:<28} НЕТ")

    # ─── 6. текстовые строки ───
    print("\n" + "-" * 74)
    print("ТЕКСТОВЫЕ СТРОКИ (длина >= 6), первые 40")
    print("-" * 74)
    strings = []
    cur = bytearray()
    for i, b in enumerate(data):
        if 32 <= b < 127:
            cur.append(b)
        else:
            if len(cur) >= 6:
                strings.append((i - len(cur), cur.decode("latin1")))
            cur = bytearray()
    if len(cur) >= 6:
        strings.append((len(data) - len(cur), cur.decode("latin1")))

    print(f"  всего строк: {len(strings)}")
    for off, s in strings[:40]:
        print(f"    @0x{off:06X}  {s}")


if __name__ == "__main__":
    main()
