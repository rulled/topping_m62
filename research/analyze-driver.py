r"""АНАЛИЗ ДРАЙВЕРА TOPPING: ЕСТЬ ЛИ ПРОВЕРКА ПРОШИВКИ?

══════════ ЗАЧЕМ ══════════

Главный блокер модификации прошивки — неизвестный формат проверки
целостности. Если карта проверяет образ при обновлении, запись
изменённого файла превратит её в кирпич.

Драйвер `ToppingProUsbAudioks.sys` — единственный артефакт, который
работает с картой на стороне Windows. В нём могут быть:
  • строки вида "firmware", "update", "verify", "MD5", "SHA";
  • команды DFU (interface 3);
  • проверка версии перед обновлением.

══════════ ЧТО ДЕЛАЕТ ЭТОТ СКРИПТ ══════════

1. Проверяет, что это настоящий PE-файл (MZ, PE).
2. Достаёт ВСЕ печатные строки (ASCII и UTF-16LE) и фильтрует
   по ключевым словам.
3. Ищет признаки DFU-обновления: имена API, GUID, номера
   команд, упоминания interface 3.
4. Печатает секции PE с размерами — где код, где данные.

Запуск: python research/analyze-driver.py
"""

from __future__ import annotations

import re
import struct
import sys
from pathlib import Path

DRIVER = Path(
    r"C:\Windows\System32\DriverStore\FileRepository"
    r"\toppingprousbaudioks.inf_amd64_3b7c998b773b06e8\ToppingProUsbAudioks.sys"
)

KEYWORDS = [
    "firmware", "Firmware", "FIRMWARE",
    "update", "Update", "upgrade", "Upgrade",
    "dfu", "DFU", "Dfu",
    "verify", "Verify", "checksum", "Checksum",
    "md5", "MD5", "sha1", "SHA1", "sha256", "SHA256",
    "signature", "Signature",
    "version", "Version",
    "flash", "Flash", "erase", "Erase",
    "Topping", "TOPPING",
    "M62", "KB22",
]


def printable_strings(data: bytes, min_len: int = 4):
    """ASCII-строки."""
    out = []
    cur = bytearray()
    start = 0
    for i, b in enumerate(data):
        if 32 <= b < 127:
            if not cur:
                start = i
            cur.append(b)
        else:
            if len(cur) >= min_len:
                out.append((start, cur.decode("latin1")))
            cur = bytearray()
    if len(cur) >= min_len:
        out.append((start, cur.decode("latin1")))
    return out


def utf16_strings(data: bytes, min_len: int = 4):
    """UTF-16LE строки (буква + 0x00)."""
    out = []
    cur = bytearray()
    start = 0
    i = 0
    n = len(data)
    while i + 1 < n:
        lo, hi = data[i], data[i + 1]
        if hi == 0 and 32 <= lo < 127:
            if not cur:
                start = i
            cur.append(lo)
            i += 2
        else:
            if len(cur) >= min_len:
                out.append((start, cur.decode("latin1")))
            cur = bytearray()
            i += 1
    if len(cur) >= min_len:
        out.append((start, cur.decode("latin1")))
    return out


def main() -> None:
    if not DRIVER.exists():
        sys.exit(f"нет файла: {DRIVER}")
    data = DRIVER.read_bytes()
    print("=" * 74)
    print("АНАЛИЗ ДРАЙВЕРА TOPPING")
    print("=" * 74)
    print(f"файл: {DRIVER.name}")
    print(f"размер: {len(data)} байт")

    # ─── 1. PE ───
    print("\n" + "-" * 74)
    print("1. ФОРМАТ")
    print("-" * 74)
    is_mz = data[:2] == b"MZ"
    print(f"  MZ-заголовок: {'ДА' if is_mz else 'НЕТ'}")
    pe_off = struct.unpack_from("<I", data, 0x3C)[0] if is_mz else 0
    is_pe = is_mz and data[pe_off : pe_off + 4] == b"PE\0\0"
    print(f"  PE-подпись: {'ДА' if is_pe else 'НЕТ'}  @0x{pe_off:X}")

    if is_pe:
        machine = struct.unpack_from("<H", data, pe_off + 4)[0]
        nsec = struct.unpack_from("<H", data, pe_off + 6)[0]
        print(f"  машина: 0x{machine:04X}  секций: {nsec}")
        opt_size = struct.unpack_from("<H", data, pe_off + 20)[0]
        sec_off = pe_off + 24 + opt_size
        print("\n  секции:")
        for i in range(nsec):
            o = sec_off + i * 40
            name = data[o : o + 8].rstrip(b"\0").decode("latin1")
            vsize = struct.unpack_from("<I", data, o + 8)[0]
            vaddr = struct.unpack_from("<I", data, o + 12)[0]
            rsize = struct.unpack_from("<I", data, o + 16)[0]
            print(f"    {name:<10} vaddr=0x{vaddr:08X} vsize=0x{vsize:<8X} raw=0x{rsize:X}")

    # ─── 2. ключевые строки ───
    print("\n" + "-" * 74)
    print("2. КЛЮЧЕВЫЕ СТРОКИ (ASCII)")
    print("-" * 74)
    strs = printable_strings(data, 4)
    print(f"  всего ASCII-строк: {len(strs)}")
    hits = []
    for off, s in strs:
        for kw in KEYWORDS:
            if kw in s:
                hits.append((off, s, kw))
                break
    print(f"  с ключевыми словами: {len(hits)}")
    seen = set()
    for off, s, kw in hits:
        if s in seen:
            continue
        seen.add(s)
        print(f"    @0x{off:06X}  [{kw}]  {s[:78]}")
        if len(seen) > 60:
            print("    … (обрезано)")
            break

    # ─── 3. UTF-16 строки ───
    print("\n" + "-" * 74)
    print("3. КЛЮЧЕВЫЕ СТРОКИ (UTF-16LE)")
    print("-" * 74)
    ustr = utf16_strings(data, 4)
    print(f"  всего UTF-16 строк: {len(ustr)}")
    uhits = []
    for off, s in ustr:
        for kw in KEYWORDS:
            if kw in s:
                uhits.append((off, s, kw))
                break
    print(f"  с ключевыми словами: {len(uhits)}")
    seen = set()
    for off, s, kw in uhits:
        if s in seen:
            continue
        seen.add(s)
        print(f"    @0x{off:06X}  [{kw}]  {s[:78]}")
        if len(seen) > 40:
            break

    # ─── 4. имена API ───
    print("\n" + "-" * 74)
    print("4. ПОДОЗРИТЕЛЬНЫЕ API (DFU / прошивка / память)")
    print("-" * 74)
    api_words = [
        "Io", "Hal", "Ke", "Mm", "Zw", "Rtl",
        "Firmware", "Dfu", "Flash", "Spi", "I2c", "Smbus",
    ]
    apis = set()
    for off, s in strs:
        if len(s) < 6:
            continue
        # вид ApiName или Api_Name
        if re.fullmatch(r"[A-Z][A-Za-z0-9_]{5,}", s):
            for w in api_words:
                if s.startswith(w):
                    apis.add(s)
                    break
    # оставляем только те, что связаны с прошивкой/памятью
    interesting = sorted(
        a for a in apis
        if any(k in a.lower() for k in ("firm", "dfu", "flash", "spi", "i2c", "smbus", "upgrade"))
    )
    print(f"  найдено подозрительных: {len(interesting)}")
    for a in interesting[:40]:
        print(f"    {a}")

    # ─── 5. GUID ───
    print("\n" + "-" * 74)
    print("5. GUID (могут указывать на DFU-интерфейс)")
    print("-" * 74)
    guids = set()
    for off, s in strs:
        if re.fullmatch(r"\{[0-9A-Fa-f\-]{36}\}", s):
            guids.add(s)
    print(f"  найдено: {len(guids)}")
    for g in sorted(guids)[:20]:
        print(f"    {g}")

    # ─── ВЫВОД ───
    print("\n" + "=" * 74)
    print("ЧТО ЭТО ДАЁТ")
    print("=" * 74)
    fw_hits = [h for h in hits + uhits if "firm" in h[1].lower()]
    dfu_hits = [h for h in hits + uhits if "dfu" in h[1].lower() or "upgrade" in h[1].lower()]
    print(f"  строк про прошивку: {len(fw_hits)}")
    print(f"  строк про DFU/обновление: {len(dfu_hits)}")
    print("")
    if not fw_hits and not dfu_hits:
        print("  Драйвер НЕ содержит строк об обновлении прошивки.")
        print("  Значит обновление делает ПРИЛОЖЕНИЕ (MCC), а не драйвер,")
        print("  либо оно спрятано в коде без строк.")
        print("  Проверку целостности надо искать в MCC.")
    else:
        print("  Есть следы работы с прошивкой — смотрим строки выше.")


if __name__ == "__main__":
    main()
