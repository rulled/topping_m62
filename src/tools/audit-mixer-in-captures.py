r"""Проверить ВСЕ захваты: приходят ли кросспоинты микшера в IN?

═══════════ ЗАЧЕМ ═══════════

В `docs/MIXER.md` записано: «из 242 адресов, которые MCC пишет в
брекете, в IN приходят только 3. Микшер в IN отсутствует полностью».

Это вывод по ОДНОМУ захвату (`mixer-sources.pcap`). Прежде чем
строить UI на утверждении «микшер не читается», надо проверить его
на ВСЕХ захватах: возможно, в каком-то режиме или после какой-то
последовательности карта всё же отдаёт кросспоинты.

Ошибка метода уже случалась с EQ: там «не читается» было следствием
неправильного способа чтения (§159). Здесь проверяем факты.

═══════════ ЧТО СЧИТАЕТСЯ КРОССПОИНТОМ ═══════════

    TT = 0x31,0x32,0x33,0x34,0x35,0x36,0x37,0x38,0x3b,0x3c
         (10 групп = 5 шин × L/R; 0x39 и 0x3a НЕ входят)
    PP = 0x01..0x14   (20 свойств = 10 стерео-источников × 2)

    PP = 0x15         — метр канала, НЕ кросспоинт
    TT = 0x39         — метры микшера, НЕ группа (см. NOTES)

═══════════ ЛОВУШКА, В КОТОРУЮ Я УЖЕ ПОПАЛ ═══════════

Первая рабочая версия проверяла диапазон `0x31..0x3c`, и в него
попал `0x39:0x01/0x02` — метры. Скрипт торжественно напечатал
«читать микшер МОЖНО». Это ложь: метры приходят всегда, кросспоинты
из них не восстановить.

Поэтому группы перечислены ЯВНО, а не диапазоном.
"""

from __future__ import annotations

import struct
import sys
from collections import defaultdict
from pathlib import Path

MAGIC_HEAD = b"\x22\x33"
MAGIC_TAIL = b"\x66\x77"
FRAME_LEN = 15

# Группы микшера — явный список. 0x39/0x3a сюда НЕ входят: это метры.
MIXER_GROUPS = {0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x3B, 0x3C}


def direction_map(path: Path, want_dev: int = 6):
    """Разделить кадры на OUT/IN.

    ═══ ФОРМАТ USBPcap (проверен на деле) ═══

    Собственный парсер у меня сначала был написан «по памяти» и не
    прочитал НИ ОДНОГО захвата: я считал длину заголовка фиксированной
    (22 байта), а она лежит в первых двух байтах как uint16 и в этих
    файлах равна 28.

    Хуже: скрипт при этом печатал ВЫВОД «микшер не читается». То есть
    молчаливый сбой парсера превращался в «доказанный факт». Поэтому
    теперь при нуле просканированных файлов скрипт падает, а не
    рассуждает.

    Поля (проверены на реальном файле, а не по памяти):
        offset 0..1   header_len (uint16) = 28
        offset 16     info (0 = IN, 1 = OUT)
        offset 19..20 device (uint16)
        offset 21     endpoint  (0x02 = OUT, 0x83 = IN)
        offset 22     transfer
        offset 23..26 data_len (uint32)

    ═══ ОШИБКА, КОТОРУЮ ЗДЕСЬ ЛЕГКО СДЕЛАТЬ ═══

    Сначала я взял endpoint по смещению 16 — и получил значения
    0x00/0x01 (это `info`, направление), из-за чего ни один кадр
    не попал ни в OUT, ни в IN, и скрипт «доказал» отсутствие
    кросспоинтов. Проверка на файле показала настоящее смещение.
    """
    blob = path.read_bytes()
    endian = "<" if blob[:4] == b"\xd4\xc3\xb2\xa1" else ">"
    pos = 24
    out_frames = []
    in_frames = []
    n = len(blob)

    while pos + 16 <= n:
        (incl,) = struct.unpack_from(endian + "I", blob, pos + 8)
        data = blob[pos + 16 : pos + 16 + incl]
        pos += 16 + incl
        if incl == 0 or len(data) < 27:
            continue

        header_len = struct.unpack("<H", data[0:2])[0]
        if header_len < 27 or header_len > len(data):
            continue
        dev = struct.unpack("<H", data[19:21])[0]
        if dev != want_dev:
            continue
        ep = data[21]
        data_len = struct.unpack("<I", data[23:27])[0]
        payload = data[header_len : header_len + data_len]

        for chunk in frames(payload):
            if ep == 0x02:
                out_frames.append(chunk)
            elif ep == 0x83:
                in_frames.append(chunk)
    return out_frames, in_frames


def frames(payload: bytes):
    """Вырезать 15-байтовые кадры M62 из полезной нагрузки."""
    out = []
    start = 0
    while True:
        i = payload.find(MAGIC_HEAD, start)
        if i < 0:
            break
        chunk = payload[i : i + FRAME_LEN]
        if len(chunk) == FRAME_LEN and chunk[-2:] == MAGIC_TAIL:
            out.append(chunk)
        start = i + 1
    return out


def parse(frame: bytes):
    """TT, PP, value из кадра."""
    tt = frame[5]
    pp = frame[6]
    (val,) = struct.unpack_from(">i", frame, 7)
    return tt, pp, val


def is_crosspoint(tt: int, pp: int) -> bool:
    """Кросспоинт ли это.

    Группы перечислены ЯВНО. Диапазон 0x31..0x3c захватывает 0x39
    и 0x3a — а это метры микшера, они приходят всегда. Из-за
    диапазона скрипт один раз уже «доказал», что микшер читается.
    """
    return tt in MIXER_GROUPS and 0x01 <= pp <= 0x14


def main():
    root = Path("research")
    pcaps = sorted(root.rglob("*.pcap"), key=lambda p: p.stat().st_size, reverse=True)

    if not pcaps:
        print("захватов не найдено")
        return 1

    print("=" * 74)
    print("ПРИХОДЯТ ЛИ КРОССПОИНТЫ МИКШЕРА В IN? (проверка всех захватов)")
    print("=" * 74)
    print(f"\nзахватов: {len(pcaps)}\n")

    total_in_cp = 0
    total_out_cp = 0
    scanned = 0

    header = f"{'файл':<34} {'MB':>6} {'OUT cp':>7} {'IN cp':>7}  {'IN-адреса кросспоинтов'}"
    print(header)
    print("-" * 74)

    found_in = defaultdict(set)

    for p in pcaps:
        try:
            out_f, in_f = direction_map(p)
        except Exception as e:  # noqa: BLE001
            print(f"{p.name:<34} {'ERR':>6}  {e}")
            continue

        if not out_f and not in_f:
            continue
        scanned += 1

        out_cp = {f"{parse(f)[0]:02x}:{parse(f)[1]:02x}" for f in out_f
                  if is_crosspoint(*parse(f)[:2])}
        in_cp = {f"{parse(f)[0]:02x}:{parse(f)[1]:02x}" for f in in_f
                 if is_crosspoint(*parse(f)[:2])}

        total_out_cp += len(out_cp)
        total_in_cp += len(in_cp)
        for addr in in_cp:
            found_in[addr].add(p.name)

        mb = p.stat().st_size / 1024 / 1024
        sample = ", ".join(sorted(in_cp)[:4]) if in_cp else "—"
        print(f"{p.name:<34} {mb:>6.1f} {len(out_cp):>7} {len(in_cp):>7}  {sample}")

    print("-" * 74)
    print(f"\nпросканировано захватов: {scanned}")
    print(f"уникальных кросспоинтов в OUT: {total_out_cp}")
    print(f"уникальных кросспоинтов в IN:  {total_in_cp}")

    # ═══ ЗАЩИТА ОТ ЛОЖНОГО ВЫВОДА ═══
    #
    # Первая версия этого скрипта не прочитала НИ ОДНОГО файла (парсер
    # был сломан) — и всё равно напечатала «ВЫВОД: микшер не читается».
    # Молчаливый сбой инструмента превратился в «доказанный факт».
    #
    # Поэтому: если ни один файл не разобран, это ОШИБКА, а не вывод.
    if scanned == 0:
        print("\n" + "!" * 74)
        print("ОШИБКА: ни один захват не разобран.")
        print("!" * 74)
        print("""
Это НЕ означает «кросспоинтов нет» — это означает, что парсер не
прочитал файлы. Проверять надо парсер, а не делать выводы о карте.
""")
        return 2

    if total_out_cp == 0:
        print("\n" + "!" * 74)
        print("ОШИБКА: в OUT не найдено ни одного кросспоинта.")
        print("!" * 74)
        print("""
Микшер точно писался (это есть в docs/MIXER.md и подтверждено
decode-mixer.py). Если OUT пуст — сломан разбор, а не карта.
""")
        return 2

    if total_in_cp == 0:
        print("\n" + "=" * 74)
        print("ВЫВОД: микшер НЕ ЧИТАЕТСЯ.")
        print("=" * 74)
        print("""
Ни в одном захвате кросспоинты 0x31..0x3c:0x01..0x14 не пришли в IN,
хотя в OUT их писали сотнями. Это свойство протокола, а не ошибка
метода: карта принимает матрицу, но не отдаёт её обратно.

Следствие для сервиса: состояние микшера надо хранить у себя
(в браузере — localStorage, как решили для сцен) и показывать его
как «нашу модель», честно помечая, что карта не подтверждает
прочитанное.

Остаётся открытым: как ПОДТВЕРДИТЬ, что запись применилась.
Кандидат — метры шин 0x33..0x36:0x15 и 0x39:0x01/02. Они приходят
всегда и реагируют на сигнал.
""")
    else:
        print("\n" + "=" * 74)
        print("ВЫВОД: читать микшер МОЖНО — адреса найдены.")
        print("=" * 74)
        for addr, files in sorted(found_in.items()):
            print(f"  {addr}  в {len(files)} захватах: {', '.join(sorted(files)[:3])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
