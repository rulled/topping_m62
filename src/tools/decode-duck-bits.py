r"""СВОДКА ПО 8 ЗАХВАТАМ: какой флаг соответствует какому биту.

══════════ ЧТО ДЕЛАЕТ ══════════

`capture-duck-bits-all.ps1` для каждого из 8 флагов IN1 выключил
РОВНО ОДИН флаг, запустил MCC под захватом и сохранил файл.

В каждом захвате находим `0x43:0x05` (маска IN1). У выключенного
флага бит будет 0, у остальных 1.

Собираем таблицу: в каком захвате какой бит сброшен.

Запуск: python src/tools/decode-duck-bits.py <результаты.json> <папка>
"""

from __future__ import annotations

import json
import struct
import sys
from pathlib import Path

MAGIC_HEAD = b"\x22\x33"
MAGIC_TAIL = b"\x66\x77"
FRAME_LEN = 15


def read_packets(path: Path):
    blob = path.read_bytes()
    endian = "<" if blob[:4] == b"\xd4\xc3\xb2\xa1" else ">"
    off = 24
    while off + 16 <= len(blob):
        _, _, incl, _ = struct.unpack(endian + "IIII", blob[off : off + 16])
        off += 16
        data = blob[off : off + incl]
        off += incl
        if len(data) < 27:
            continue
        hlen = struct.unpack("<H", data[0:2])[0]
        if hlen < 27 or hlen > len(data):
            continue
        yield data[21], data[hlen : hlen + struct.unpack("<I", data[23:27])[0]]


def frames(payload: bytes):
    start = 0
    while True:
        pos = payload.find(MAGIC_HEAD, start)
        if pos < 0:
            return
        chunk = payload[pos : pos + FRAME_LEN]
        if len(chunk) == FRAME_LEN and chunk[13:15] == MAGIC_TAIL:
            yield chunk[5], chunk[6], struct.unpack(">i", chunk[7:11])[0]
        start = pos + 1


def mask_from_capture(path: Path, prop: int = 0x05) -> int | None:
    """Значение 0x43:prop, отправленное хостом. None если не нашли."""
    values = set()
    for ep, payload in read_packets(path):
        if ep & 0x80:
            continue
        for tt, pp, val in frames(payload):
            if tt == 0x43 and pp == prop:
                values.add(val)
    if not values:
        return None
    # берём самое частое (на случай повторов)
    from collections import Counter
    return Counter(
        v for ep, payload in read_packets(path) if not (ep & 0x80)
        for tt, pp, v in frames(payload) if tt == 0x43 and pp == prop
    ).most_common(1)[0][0]


def main() -> None:
    if len(sys.argv) < 3:
        raise SystemExit("использование: decode-duck-bits.py <result.json> <outDir>")
    results_path = Path(sys.argv[1])
    out_dir = Path(sys.argv[2])

    if not results_path.exists():
        raise SystemExit(f"нет файла результатов: {results_path}")

    # utf-8-sig: PowerShell добавляет BOM при Set-Content -Encoding UTF8
    results = json.loads(results_path.read_text(encoding="utf-8-sig"))
    if isinstance(results, dict):
        results = [results]

    print("=" * 74)
    print("РАСШИФРОВКА БИТОВ МАСКИ DUCKING")
    print("=" * 74)
    print(f"захватов: {len(results)}\n")

    # --- по каждому захвату ---
    rows = []
    for r in results:
        flag = r.get("flag", "?")
        file = Path(r.get("file", ""))
        if not file.exists():
            file = out_dir / f"bit-{flag}.pcap"
        if not file.exists():
            print(f"  {flag}: файл не найден ({file})")
            continue

        m1 = mask_from_capture(file, 0x05)
        m2 = mask_from_capture(file, 0x06)

        if m1 is None:
            print(f"  {flag}: маска IN1 не найдена в захвате")
            rows.append({"flag": flag, "m1": None, "m2": m2})
            continue

        # какой бит сброшен относительно 255
        cleared = [i for i in range(8) if not (m1 & (1 << i))]
        print(f"  {flag:<18} маска IN1 = {m1:3}  сброшены биты: {cleared or '—'}"
              + (f"   маска IN2 = {m2}" if m2 is not None else ""))
        rows.append({"flag": flag, "m1": m1, "m2": m2, "cleared": cleared})

    # --- сводная таблица ---
    print("\n" + "=" * 74)
    print("ТАБЛИЦА: ФЛАГ -> БИТ")
    print("=" * 74)

    mapping = {}
    ambiguous = []

    for row in rows:
        cleared = row.get("cleared") or []
        if len(cleared) == 1:
            bit = cleared[0]
            mapping[bit] = row["flag"]
            print(f"  {row['flag']:<18} -> бит {bit}")
        elif len(cleared) == 0:
            print(f"  {row['flag']:<18} -> НЕ СБРОСИЛСЯ (маска 255?)")
            ambiguous.append((row["flag"], "не сбросился"))
        else:
            print(f"  {row['flag']:<18} -> неоднозначно: биты {cleared}")
            ambiguous.append((row["flag"], f"биты {cleared}"))

    # --- итоговая маска ---
    print("\n" + "=" * 74)
    print("ИТОГОВАЯ КАРТА БИТОВ")
    print("=" * 74)
    if mapping:
        for bit in sorted(mapping):
            print(f"  бит {bit} = {mapping[bit]}")
        missing = [b for b in range(8) if b not in mapping]
        if missing:
            print(f"\n  не определены: биты {missing}")
    else:
        print("  ни один бит не определён")

    if ambiguous:
        print("\n  ПРОБЛЕМЫ:")
        for flag, why in ambiguous:
            print(f"    {flag}: {why}")

    # --- готовый код ---
    if mapping:
        print("\n" + "=" * 74)
        print("КОД ДЛЯ src/duck-loopback-hid.js")
        print("=" * 74)
        print("\nexport const DUCK_MASK_BITS = {")
        for bit in sorted(mapping):
            print(f"  {bit}: '{mapping[bit].replace('IN1', '')}',")
        print("};")


if __name__ == "__main__":
    main()
