r"""ИТОГОВЫЙ АНАЛИЗ ПРОШИВКИ M62: СТРУКТУРА ЗАГОЛОВКА И ПОВТОРЫ.

══════════ ЧТО УЖЕ УСТАНОВЛЕНО ТОЧНО ══════════

1. Файл 1 216 512 байт (0x129000), энтропия обычная (93.9% блоков
   в диапазоне 3..7 бит) — НЕ сжат и НЕ зашифрован целиком.
2. Сигнатуры gzip, x86-jmp, кадров M62 — ЛОЖНЫЕ (проверен контекст).
3. Крупных дубликатов (4 КБ, 16 КБ) нет — все блоки уникальны.
4. Заголовок содержит пары, похожие на (размер, смещение).

══════════ ЧТО ПРОВЕРЯЕТ ЭТОТ СКРИПТ ══════════

1. Гипотеза «таблица записей»: заголовок как массив структур
   фиксированного размера. Проверяем, что поля читаются как
   (offset, size) и укладываются в файл.
2. Мелкие повторы: ищем ВСЕ повторяющиеся 16-байтовые блоки
   и смотрим, на каком расстоянии они лежат.
3. Если расстояние постоянно — это шаг массива записей.

Запуск: python research/firmware-conclusion.py
"""

from __future__ import annotations

import struct
import sys
from collections import defaultdict
from pathlib import Path

FW = Path("research/firmware/M62_FW87.05.45.48.27/M62_FW87.05.45.48.27.bin")


def main() -> None:
    if not FW.exists():
        sys.exit(f"нет файла: {FW}")
    data = FW.read_bytes()
    n = len(data)
    print("=" * 74)
    print("ИТОГОВЫЙ АНАЛИЗ ПРОШИВКИ M62")
    print("=" * 74)
    print(f"размер: {n} байт (0x{n:X})")

    # ─── 1. гипотеза «таблица записей в заголовке» ───
    print("\n" + "-" * 74)
    print("1. ЗАГОЛОВОК КАК ТАБЛИЦА ЗАПИСЕЙ")
    print("-" * 74)

    # смотрим слова 13..31 и пробуем трактовать пары (a,b) как
    # (offset,size) или (size,offset)
    print("  слова 13..31 и их трактовка как смещение/размер:")
    for i in range(13, 32):
        w = struct.unpack_from("<I", data, i * 4)[0]
        in_file = w < n
        print(f"    [{i:2}] 0x{i*4:03X} = 0x{w:08X} {w:10}  {'в файле' if in_file else ''}")

    # проверяем: есть ли последовательность валидных (offset,size)
    print("\n  проверка пар (offset, size) с шага 15 по 4:")
    for start in (13, 15, 17, 19, 21, 24):
        pairs = []
        ok = 0
        tried = 0
        for k in range(4):
            o = start + k * 2
            if o + 1 >= 32:
                break
            off = struct.unpack_from("<I", data, o * 4)[0]
            size = struct.unpack_from("<I", data, (o + 1) * 4)[0]
            tried += 1
            good = 0 <= off < n and 0 < size <= n and off + size <= n
            if good:
                ok += 1
            pairs.append((off, size, good))
        if tried and ok:
            print(f"    старт {start}: {ok}/{tried} пар валидны")
            for off, size, good in pairs:
                mark = "OK " if good else "нет"
                print(f"      offset=0x{off:06X} size={size:8}  {mark}")

    # ─── 2. мелкие повторы 16 байт ───
    print("\n" + "-" * 74)
    print("2. ПОВТОРЯЮЩИЕСЯ 16-БАЙТОВЫЕ БЛОКИ")
    print("-" * 74)
    BLK = 16
    seen = defaultdict(list)
    for off in range(0, n - BLK + 1, BLK):  # выровненные по 16
        seen[data[off : off + BLK]].append(off)

    dups = [(k, v) for k, v in seen.items() if len(v) > 1]
    # отбрасываем блоки из нулей и FF — они тривиальны
    dups = [
        (k, v)
        for k, v in dups
        if k.strip(b"\x00") and k.strip(b"\xff")
    ]
    print(f"  выровненных 16-байтовых блоков: {len(seen)}")
    print(f"  нетривиальных повторов: {len(dups)}")

    dists = []
    for k, offs in dups[:20]:
        d = [offs[i + 1] - offs[i] for i in range(len(offs) - 1)]
        dists.extend(d)
        print(f"    {k.hex(' ')}  x{len(offs)}  @{[hex(o) for o in offs]}")
        print(f"        расстояния: {[hex(x) for x in d]}")

    if dists:
        from collections import Counter

        c = Counter(dists)
        print("\n  частые расстояния между повторами:")
        for d, cnt in c.most_common(6):
            print(f"    0x{d:06X} ({d:8})  {cnt} раз  {'<-- ВОЗМОЖНЫЙ ШАГ' if cnt > 2 else ''}")

    # ─── 3. поиск шага массива записей ───
    print("\n" + "-" * 74)
    print("3. ПОИСК ШАГА МАССИВА ЗАПИСЕЙ (сравнение соседних окон)")
    print("-" * 74)
    print("  если файл — массив записей длины S, то блоки через S байт")
    print("  будут статистически похожи (одинаковые поля на своих местах)")

    def similarity(shift: int, sample: int = 131072) -> float:
        """Доля позиций, где ОБА байта равны нулю или оба ненулевые."""
        a = data[:sample]
        b = data[shift : shift + sample]
        m = min(len(a), len(b))
        if m <= 0:
            return 0.0
        agree = 0
        for i in range(m):
            if (a[i] == 0) == (b[i] == 0):
                agree += 1
        return agree / m

    cands = []
    for shift in [64, 128, 192, 256, 384, 512, 768, 1024, 1536, 2048,
                  0x1000, 0x2000, 0x4000, 0x8000, 0x10000, 0x20000, 0x40000]:
        if shift < n:
            cands.append((shift, similarity(shift)))
    cands.sort(key=lambda x: -x[1])
    print("\n  топ по «структурному подобию»:")
    for shift, sim in cands[:8]:
        print(f"    0x{shift:06X} ({shift:7})  подобие {sim*100:5.2f}%")

    # ─── 4. ВЫВОД ───
    print("\n" + "=" * 74)
    print("ВЫВОД О ПРОШИВКЕ")
    print("=" * 74)
    print("""
  Что установлено ТОЧНО:
    • файл не сжат и не зашифрован (энтропия обычная);
    • исполняемого кода нет: ни ELF, ни ARM-таблицы векторов,
      «x86-инструкции» оказались данными;
    • кадров протокола внутри нет — теги 0x91/0x93 и т.п. не зашиты;
    • крупных дубликатов нет — блоки уникальны;
    • заголовок содержит осмысленные пары размеров.

  Что это значит для вопроса «можно ли добавить фичи»:
    Прошивка — КОНТЕЙНЕР ДАННЫХ (таблицы коэффициентов, калибровки).
    Кода обработчика кадра в ней НЕТ. Он исполняется на чипе и в
    этот образ не входит.

    Отсюда: статический анализ ЭТОГО файла не может ответить,
    поддерживает ли карта чужие DSP-команды. Ответ даёт только
    поведение устройства (что мы и делаем с §135 по §155).

  Что МОЖНО проверить дальше:
    1. Формат проверки целостности — без него нельзя менять файл.
       (В KB22 есть MD5 + UID; для M62 не установлено.)
    2. Сравнить с прошивкой KB22 — там есть код и известная структура.
    3. Искать другой артефакт: дамп чипа через DFU (ОПАСНО, не делать).
""")


if __name__ == "__main__":
    main()
