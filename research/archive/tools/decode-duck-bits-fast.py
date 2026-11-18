r"""РАЗБОР 3 ЗАХВАТОВ: подтверждение порядка битов маски ducking.

══════════ ИДЕЯ ══════════

`capture-duck-bits-fast.ps1` задаёт шаблоны флагов, у которых
уникальные двоичные подписи:

    шаг all    IN1 = все 8            ожидаем 255
    шаг a1b2   IN1 = BT,PB12,PB56,PB910 (биты 1,3,5,7)   170
               IN2 = OTGIN,PB34,PB78   (биты 2,4,6)      84
    шаг b1a2   IN1 и IN2 наоборот                         84 / 170

Если гипотеза «бит = порядок флагов в INI» верна, наблюдаемые
маски совпадут с ожидаемыми.

Плюс шаг a1b2/b1a2 доказывает, что 0x43:05 = IN1, а 0x43:06 = IN2
(маски перекрёстно меняются местами).

Запуск:
  python src/tools/decode-duck-bits-fast.py <результаты.json> <папка>
"""

from __future__ import annotations

import json
import struct
import sys
from collections import Counter
from pathlib import Path

MAGIC_HEAD = b"\x22\x33"
MAGIC_TAIL = b"\x66\x77"
FRAME_LEN = 15

ORDER = [
    "AUX",
    "BT",
    "OTGIN",
    "Playback1_2",
    "Playback3_4",
    "Playback5_6",
    "Playback7_8",
    "Playback9_10",
]


def read_packets(path: Path):
    """Пакеты из libpcap. Возвращает (endpoint, payload)."""
    blob = path.read_bytes()
    if blob[:4] == b"\xd4\xc3\xb2\xa1":
        endian = "<"
    elif blob[:4] == b"\xa1\xb2\xc3\xd4":
        endian = ">"
    elif blob[:4] == b"\x4d\x3c\xb2\xa1":
        endian = "<"
    elif blob[:4] == b"\xa1\xb2\x3c\x4d":
        endian = ">"
    else:
        raise SystemExit(f"{path.name}: неизвестный формат pcap")

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
        dlen = struct.unpack("<I", data[23:27])[0]
        yield data[21], data[hlen : hlen + dlen]


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


def mask_from_capture(path: Path, prop: int) -> tuple[int | None, list[int]]:
    """Самое частое значение 0x43:prop, отправленное хостом.

    Возвращает (значение, все встреченные значения по возрастанию).
    """
    vals = []
    for ep, payload in read_packets(path):
        if ep & 0x80:  # только OUT (хост -> устройство)
            continue
        for tt, pp, val in frames(payload):
            if tt == 0x43 and pp == prop:
                vals.append(val)
    if not vals:
        return None, []
    best = Counter(vals).most_common(1)[0][0]
    return best, sorted(set(vals))


def bits(value: int | None) -> str:
    if value is None:
        return "—"
    on = [ORDER[i] for i in range(8) if value & (1 << i)]
    return ", ".join(on) if on else "(ничего)"


def flag_to_bit(flag: str) -> int:
    return ORDER.index(flag)


def expected_mask(flags_csv: str) -> int:
    m = 0
    for f in flags_csv.split(","):
        f = f.strip()
        if f:
            m |= 1 << flag_to_bit(f)
    return m


def main() -> None:
    if len(sys.argv) < 3:
        raise SystemExit("использование: decode-duck-bits-fast.py <result.json> <outDir>")
    results_path = Path(sys.argv[1])
    out_dir = Path(sys.argv[2])

    if not results_path.exists():
        raise SystemExit(f"нет файла результатов: {results_path}")

    # utf-8-sig: PowerShell Set-Content -Encoding UTF8 ставит BOM
    results = json.loads(results_path.read_text(encoding="utf-8-sig"))
    if isinstance(results, dict):
        results = [results]

    print("=" * 76)
    print("РАСШИФРОВКА БИТОВ МАСКИ DUCKING (3 шаблона)")
    print("=" * 76)
    print(f"захватов: {len(results)}\n")

    rows = []
    for r in results:
        label = r.get("label", "?")
        file = Path(r.get("file", ""))
        if not file.exists():
            file = out_dir / f"step-{label}.pcap"
        if not file.exists():
            print(f"  {label}: файл не найден ({file})")
            continue

        m1, seen1 = mask_from_capture(file, 0x05)
        m2, seen2 = mask_from_capture(file, 0x06)

        exp1 = expected_mask(r.get("flagsIn1", ""))
        exp2 = expected_mask(r.get("flagsIn2", ""))

        print(f"  шаг {label}")
        print(f"    IN1: ожидали {exp1:3}  получили {str(m1):>4}"
              f"   все значения: {seen1}")
        print(f"    IN2: ожидали {exp2:3}  получили {str(m2):>4}"
              f"   все значения: {seen2}")
        if m1 is not None:
            print(f"    IN1 по битам: {bits(m1)}")
        if m2 is not None:
            print(f"    IN2 по битам: {bits(m2)}")
        print()

        rows.append(
            {
                "label": label,
                "m1": m1,
                "m2": m2,
                "exp1": exp1,
                "exp2": exp2,
                "seen1": seen1,
                "seen2": seen2,
            }
        )

    if not rows:
        raise SystemExit("ни одного разобранного захвата")

    print("=" * 76)
    print("ВЕРДИКТ")
    print("=" * 76)

    # 1. маска вообще отправляется?
    all_row = next((r for r in rows if r["label"] == "all"), None)
    if all_row and all_row["m1"] is None:
        print("  МАСКА НЕ НАЙДЕНА ни в одном захвате.")
        print("  Значит MCC в этом режиме её не шлёт — нужен другой подход.")
        return

    # 2. порядок битов подтверждён?
    checked = [r for r in rows if r["m1"] is not None]
    ok1 = [r for r in checked if r["m1"] == r["exp1"]]
    ok2 = [r for r in checked if r["m2"] == r["exp2"]]
    all_ok = len(ok1) == len(checked) and len(ok2) == len(checked)

    if all_ok:
        print("  ПОРЯДОК БИТОВ ПОДТВЕРЖДЁН на всех шаблонах.")
        print("  Биты маски = порядок флагов в секции [Ducking]:\n")
        for b, name in enumerate(ORDER):
            print(f"    бит {b} = {name}")
    else:
        print("  Ожидаемого совпадения НЕТ. Разбор по шагам:\n")
        for r in checked:
            mark1 = "ok" if r["m1"] == r["exp1"] else "МИМО"
            mark2 = "ok" if r["m2"] == r["exp2"] else "МИМО"
            print(f"    {r['label']:<6} IN1 {r['m1']:3} vs {r['exp1']:3} [{mark1}]"
                  f"   IN2 {str(r['m2']):>4} vs {r['exp2']:3} [{mark2}]")

        # если гипотеза мимо — попробуем восстановить соответствие
        # по шаблонам: у каждого флага своя подпись «в каком шаге был 1»
        print("\n  ПРОБУЮ ВОССТАНОВИТЬ СООТВЕТСТВИЕ ПО ПОДПИСЯМ ШАБЛОНОВ:")
        sig = {}
        for b, name in enumerate(ORDER):
            pat = tuple(
                bool(r["exp1"] & (1 << b)) for r in checked
            )
            obs = tuple(
                bool(r["m1"] & (1 << bit)) for r in checked
                for bit in range(8)
            )
            sig.setdefault(pat, []).append(name)
        for pat, names in sig.items():
            print(f"    подпись шаблонов {pat}: флаги {names}")
        print("\n    Наблюдаемые подписи битов (по IN1):")
        for bit in range(8):
            obs = tuple(bool(r["m1"] & (1 << bit)) for r in checked)
            matches = [n for p, ns in sig.items() if p == obs for n in ns]
            print(f"      бит {bit}: {obs}  -> {matches or 'НЕ НАЙДЕН'}")

    # 3. 0x43:05 = IN1?
    swap = [r for r in checked if r["m1"] is not None and r["m2"] is not None]
    if swap:
        same = all(r["m1"] == r["exp1"] for r in swap)
        crossed = all(r["m1"] == r["exp2"] and r["m2"] == r["exp1"] for r in swap)
        print()
        if same:
            print("  0x43:05 = маска IN1, 0x43:06 = маска IN2  — подтверждено")
        elif crossed:
            print("  0x43:05 = маска IN2, 0x43:06 = маска IN1  — НАОБОРОТ!")
        else:
            print("  привязка 0x43:05/06 к IN1/IN2 не подтверждена однозначно")

    # 4. готовый код
    if all_ok:
        print("\n" + "=" * 76)
        print("КОД ДЛЯ src/duck-loopback-hid.js")
        print("=" * 76)
        print("\nexport const DUCK_MASK_BITS = {")
        for b, name in enumerate(ORDER):
            print(f"  {b}: '{name}',")
        print("};")


if __name__ == "__main__":
    main()
