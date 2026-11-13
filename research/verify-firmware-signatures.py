r"""ПРОВЕРКА СИГНАТУР ПРОШИВКИ: НАСТОЯЩИЕ ИЛИ СОВПАДЕНИЯ?

══════════ ЗАЧЕМ ══════════

Прошлый скрипт нашёл в файле:
  • gzip (1f 8b) в двух местах;
  • «AMD/Intel jmp» (ff 25) в двух;
  • 0x22 0x33 и 0x66 0x77 (границы кадров M62).

В файле 1.2 МБ случайные двухбайтовые совпадения ОБЯЗАТЕЛЬНО будут:
вероятность встретить конкретную пару ≈ N/65536 = 18 раз. Так что
сам факт находки ничего не значит — надо проверить КОНТЕКСТ.

══════════ ЧТО ПРОВЕРЯЕТСЯ ══════════

1. gzip: у настоящего заголовка после 1f 8b идёт 08 (deflate),
   затем флаги, mtime, XFL, OS. Если байт 2 != 0x08 — это не gzip.
2. ff 25: это `jmp [rip+disp32]` в x86-64. Проверяем, похоже ли
   окружение на код (частые c3/e8/48 89) или на данные.
3. 0x22 0x33: если это начало кадра, то через 15 байт должен быть
   66 77, а в байтах 2..4 — 20 01 01.
4. Строки: 864 штуки, но почти все — мусор из данных. Ищем
   осмысленные (латиница/цифры с разделителями).

Запуск: python research/verify-firmware-signatures.py
"""

from __future__ import annotations

import struct
import sys
from pathlib import Path

FW = Path("research/firmware/M62_FW87.05.45.48.27/M62_FW87.05.45.48.27.bin")


def hexdump(data: bytes, offset: int, length: int = 64) -> str:
    chunk = data[offset : offset + length]
    lines = []
    for i in range(0, len(chunk), 16):
        row = chunk[i : i + 16]
        hx = " ".join(f"{b:02x}" for b in row)
        asc = "".join(chr(b) if 32 <= b < 127 else "." for b in row)
        lines.append(f"    {offset+i:06X}  {hx:<48}  {asc}")
    return "\n".join(lines)


def main() -> None:
    if not FW.exists():
        sys.exit(f"нет файла: {FW}")
    data = FW.read_bytes()
    print("=" * 74)
    print("ПРОВЕРКА СИГНАТУР: НАСТОЯЩИЕ ИЛИ СОВПАДЕНИЯ")
    print("=" * 74)
    print(f"файл: {len(data)} байт")

    ok_real = 0
    ok_false = 0

    # ─── 1. gzip ───
    print("\n" + "-" * 74)
    print("1. GZIP (1f 8b) — у настоящего третий байт = 08 (deflate)")
    print("-" * 74)
    pos = []
    start = 0
    while True:
        i = data.find(b"\x1f\x8b", start)
        if i < 0:
            break
        pos.append(i)
        start = i + 1
    print(f"  найдено вхождений 1f 8b: {len(pos)}")
    for p in pos:
        third = data[p + 2] if p + 2 < len(data) else None
        is_gzip = third == 0x08
        verdict = "ПОХОЖЕ НА GZIP" if is_gzip else "не gzip (третий байт не 08)"
        print(f"  @0x{p:06X}  третий байт = 0x{third:02X}  -> {verdict}")
        if is_gzip:
            ok_real += 1
            # попробуем распаковать
            try:
                import gzip as gz

                out = gz.decompress(data[p:])
                print(f"      РАСПАКОВАЛОСЬ! {len(out)} байт")
            except Exception as e:
                print(f"      распаковка не удалась: {type(e).__name__}")
        else:
            ok_false += 1
            print(hexdump(data, max(0, p - 8), 40))

    # ─── 2. x86 jmp ───
    print("\n" + "-" * 74)
    print("2. FF 25 (jmp [rip+disp32] в x86-64) — проверяем окружение")
    print("-" * 74)
    pos = []
    start = 0
    while True:
        i = data.find(b"\xff\x25", start)
        if i < 0:
            break
        pos.append(i)
        start = i + 1
    print(f"  найдено вхождений ff 25: {len(pos)} (ожидаемо ~18 по случайности)")

    def code_score(offset: int, span: int = 256) -> float:
        """Доля байтов, типичных для x86-кода."""
        chunk = data[max(0, offset - span // 2) : offset + span // 2]
        if not chunk:
            return 0.0
        code_bytes = {0xC3, 0xE8, 0xE9, 0x55, 0x48, 0x89, 0x8B, 0x0F, 0x74, 0x75, 0xEB}
        return sum(1 for b in chunk if b in code_bytes) / len(chunk)

    for p in pos:
        score = code_score(p)
        print(f"  @0x{p:06X}  плотность кодо-байтов = {score*100:5.1f}%  "
              f"{'ПОХОЖЕ НА КОД' if score > 0.15 else 'похоже на ДАННЫЕ'}")
        print(hexdump(data, max(0, p - 16), 48))

    # ─── 3. кадры M62 ───
    print("\n" + "-" * 74)
    print("3. КАДРЫ M62 (22 33 ... 66 77) — проверяем формат")
    print("-" * 74)
    pos = []
    start = 0
    while True:
        i = data.find(b"\x22\x33", start)
        if i < 0:
            break
        pos.append(i)
        start = i + 1
    print(f"  найдено вхождений 22 33: {len(pos)}")
    for p in pos:
        if p + 15 > len(data):
            continue
        frame = data[p : p + 15]
        header_ok = frame[2:5] == b"\x20\x01\x01"
        tail_ok = frame[13:15] == b"\x66\x77"
        print(f"  @0x{p:06X}  заголовок 20 01 01: {'ДА' if header_ok else 'НЕТ'}, "
              f"хвост 66 77: {'ДА' if tail_ok else 'НЕТ'}")
        if header_ok and tail_ok:
            ok_real += 1
            tt, pp = frame[5], frame[6]
            val = struct.unpack(">i", frame[7:11])[0]
            print(f"      ЭТО КАДР: 0x{tt:02X}:0x{pp:02X} = {val}")
        else:
            ok_false += 1
            print(hexdump(data, p, 24))

    # ─── 4. осмысленные строки ───
    print("\n" + "-" * 74)
    print("4. ОСМЫСЛЕННЫЕ СТРОКИ (латиница, >= 8 символов, не мусор)")
    print("-" * 74)
    import re

    # строки, где есть хотя бы 3 буквы подряд и нет редких символов
    meaningful = []
    for m in re.finditer(rb"[\x20-\x7e]{8,}", data):
        s = m.group().decode("latin1")
        letters = sum(1 for c in s if c.isalpha())
        if letters < 4:
            continue
        # отбрасываем строки вида "7@7P7`7p7"
        if not re.search(r"[A-Za-z]{3,}", s):
            continue
        meaningful.append((m.start(), s))

    print(f"  найдено: {len(meaningful)}")
    for off, s in meaningful[:40]:
        print(f"    @0x{off:06X}  {s[:70]}")

    # ─── ИТОГ ───
    print("\n" + "=" * 74)
    print("ВЫВОД")
    print("=" * 74)
    print(f"  подтверждённых структурных находок: {ok_real}")
    print(f"  ложных срабатываний:              {ok_false}")
    print("")
    print("  В файле 1.2 МБ двухбайтовые пары встречаются случайно")
    print("  в среднем 18 раз каждая. Поэтому находка сигнатуры сама")
    print("  по себе ничего не доказывает — нужен контекст.")


if __name__ == "__main__":
    main()
