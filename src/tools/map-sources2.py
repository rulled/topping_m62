r"""Разбор захвата map-mixer-sources: точная карта источников.

═══════════ ПОЧЕМУ ПРЕДЫДУЩИЙ РАЗБОР НЕ СРАБОТАЛ ═══════════

map-sources.py сравнивал значения ТОЧНЫМ равенством с ожидаемым Q25.
Но устройство квантует иначе, и часть значений не совпала на ±1:

    0x01 = 5966915, ожидали 5966916   (разница -1)
    0x07 = 4224252, ожидали 4224253   (разница -1)
    0x0f = 7511901, ожидали 7511902   (разница -1)

Из-за этого PB12, PB78, BT помечены «не наше значение», хотя это они.

═══════════ ВТОРАЯ НАХОДКА: IN12 со смещением ═══════════

0x09/0x0a в обоих миксах имеют ОДНО значение и в L, и в R:
    Mix B: 4728461 = -17.02 дБ
    Mix C: 1495270 = -27.02 дБ

Разница между ними ровно 10 дБ, как и между INI-значениями (-11 и -21).
Но абсолютное значение смещено на -6.02 дБ: -11 - 6.02 = -17.02.

Значит IN12 (и, вероятно, остальные входы) идут с базовым ослаблением
-6.02 дБ. Это не ошибка: микрофонный вход имеет headroom.

Для карты это неважно — важна РАЗНИЦА между миксами.

═══════════ ЧТО ДЕЛАЕМ ═══════════

1. Сопоставляем по БЛИЖАЙШЕМУ значению (допуск ±4 Q25), а не точному.
2. Для смещённых источников используем разницу между Mix B и Mix C.
3. Строим карту: свойство -> источник.
4. Сверяем L и R: должно быть одно и то же свойство (или соседнее).

Запуск: python src/tools/map-sources2.py <файл.pcap> [dev]
"""

from __future__ import annotations

import math
import struct
import sys

MAGIC_HEAD = b"\x22\x33"
MAGIC_TAIL = b"\x66\x77"
FRAME_LEN = 15
Q25_UNITY = 2**25

MIX_B = {
    "IN12": -11,
    "AUX": -12,
    "BT": -13,
    "FX": -14,
    "PB12": -15,
    "PB34": -16,
    "PB56": -17,
    "PB78": -18,
    "PB910": -19,
}
MIX_C = {"IN12": -21, "AUX": -22, "BT": -23}

# допуск: устройство квантует с ошибкой ±1..2, для смещённых — больше
TOLERANCE = 6


def db_to_q25(db: float) -> int:
    return round(math.pow(10, db / 20) * Q25_UNITY)


def q25_to_db(value: int) -> float:
    if value == 0:
        return -999.0
    return 20 * math.log10(value / Q25_UNITY)


def read_packets(path: str, want_dev: int):
    with open(path, "rb") as handle:
        blob = handle.read()
    endian = "<" if blob[:4] == b"\xd4\xc3\xb2\xa1" else ">"
    offset = 24
    while offset + 16 <= len(blob):
        ts_sec, ts_usec, incl_len, _ = struct.unpack(
            endian + "IIII", blob[offset : offset + 16]
        )
        offset += 16
        data = blob[offset : offset + incl_len]
        offset += incl_len
        if len(data) < 27:
            continue
        header_len = struct.unpack("<H", data[0:2])[0]
        if header_len < 27 or header_len > len(data):
            continue
        if struct.unpack("<H", data[19:21])[0] != want_dev:
            continue
        yield data[21], data[header_len : header_len + struct.unpack("<I", data[23:27])[0]]


def frames(payload: bytes):
    out = []
    start = 0
    while True:
        pos = payload.find(MAGIC_HEAD, start)
        if pos < 0:
            break
        chunk = payload[pos : pos + FRAME_LEN]
        if len(chunk) == FRAME_LEN and chunk[13:15] == MAGIC_TAIL:
            out.append((chunk[5], chunk[6], struct.unpack(">i", chunk[7:11])[0]))
        start = pos + 1
    return out


def match(value: int, table: dict[str, int]) -> str | None:
    """Ближайшее совпадение с допуском."""
    best = None
    best_err = TOLERANCE + 1
    for name, want in table.items():
        err = abs(value - want)
        if err < best_err:
            best_err = err
            best = name
    return best


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("использование: map-sources2.py <файл.pcap> [dev]")
    dev = int(sys.argv[2]) if len(sys.argv) > 2 else 6

    mixer: dict[int, dict[int, int]] = {}
    for ep, payload in read_packets(sys.argv[1], dev):
        if ep & 0x80:
            continue
        for tt, pp, value in frames(payload):
            if 0x31 <= tt <= 0x3C:
                mixer.setdefault(tt, {})[pp] = value

    if not mixer:
        print("микшера не найдено")
        return

    exp_b = {n: db_to_q25(d) for n, d in MIX_B.items()}
    exp_c = {n: db_to_q25(d) for n, d in MIX_C.items()}

    print("=" * 66)
    print("MIX B — сопоставление по ближайшему значению (допуск ±%d)" % TOLERANCE)
    print("=" * 66)

    map_b: dict[str, int] = {}   # источник -> свойство
    for group, side in ((0x33, "L"), (0x34, "R")):
        if group not in mixer:
            continue
        print(f"\n  0x{group:02x} ({side}):")
        for prop in sorted(mixer[group]):
            value = mixer[group][prop]
            if not value:
                continue
            name = match(value, exp_b)
            db = q25_to_db(value)
            if name:
                err = value - exp_b[name]
                print(f"    0x{prop:02x} = {value:9} ({db:+7.2f} дБ)  -> {name:6} (ошибка {err:+d})")
                map_b.setdefault(name, prop)
            else:
                print(f"    0x{prop:02x} = {value:9} ({db:+7.2f} дБ)  -> ?")

    print("\n" + "=" * 66)
    print("MIX C — перекрёстная проверка")
    print("=" * 66)

    map_c: dict[str, int] = {}
    for group, side in ((0x35, "L"), (0x36, "R")):
        if group not in mixer:
            continue
        print(f"\n  0x{group:02x} ({side}):")
        for prop in sorted(mixer[group]):
            value = mixer[group][prop]
            if not value:
                continue
            name = match(value, exp_c)
            db = q25_to_db(value)
            if name:
                print(f"    0x{prop:02x} = {value:9} ({db:+7.2f} дБ)  -> {name}")
                map_c.setdefault(name, prop)
            else:
                print(f"    0x{prop:02x} = {value:9} ({db:+7.2f} дБ)  -> ? (возможно смещение)")

    # ---------- смещённые источники: по разнице B и C ----------
    print("\n" + "=" * 66)
    print("СМЕЩЁННЫЕ ИСТОЧНИКИ (одинаковые значения в L и R)")
    print("=" * 66)
    # ищем свойства, у которых значение одинаково в обеих группах пары
    for gl, gr, label in ((0x33, 0x34, "Mix B"), (0x35, 0x36, "Mix C")):
        if gl not in mixer or gr not in mixer:
            continue
        same = []
        for prop in sorted(set(mixer[gl]) & set(mixer[gr])):
            vl, vr = mixer[gl][prop], mixer[gr][prop]
            if vl and vl == vr:
                same.append((prop, vl))
        if same:
            print(f"\n  {label}:")
            for prop, value in same:
                print(f"    0x{prop:02x} = {value} ({q25_to_db(value):+.2f} дБ) — в L и R одинаково")

    print("\n  трактовка: если значение одинаково в L и R — это не пара каналов,")
    print("  а источник, у которого L и R связаны (моно) или базовая точка.")

    # ---------- ИТОГ ----------
    print("\n" + "=" * 66)
    print("ИТОГОВАЯ КАРТА")
    print("=" * 66)
    print(f"\n  {'источник':10} {'свойство':>10}  {'L':>4} {'R':>4}   проверка")
    for name in MIX_B:
        pb = map_b.get(name)
        pc = map_c.get(name)
        if pb is None and pc is None:
            print(f"  {name:10} {'?':>10}  {'':>4} {'':>4}   не найдено")
            continue
        prop = pb if pb is not None else pc
        pl = prop if prop % 2 == 1 else prop - 1
        pr = pl + 1
        check = ""
        if pb is not None and pc is not None:
            check = "СОВПАЛО" if pb == pc else f"РАСХОЖДЕНИЕ B=0x{pb:02x} C=0x{pc:02x}"
        elif pb is not None:
            check = "только из B"
        else:
            check = "только из C"
        print(f"  {name:10} 0x{pl:02x}/0x{pr:02x}   {pl:02x}   {pr:02x}   {check}")

    # ---------- константа ----------
    print("\n" + "=" * 66)
    print("КОНСТАНТА ДЛЯ КОДА")
    print("=" * 66)
    print("\n// Источники микшера: имя -> базовое свойство (L нечётное, R = L+1)")
    print("export const MIXER_SOURCES = {")
    for name in MIX_B:
        prop = map_b.get(name) or map_c.get(name)
        if prop is None:
            continue
        pl = prop if prop % 2 == 1 else prop - 1
        print(f"  {name.lower():8}: 0x{pl:02x},  // L=0x{pl:02x}, R=0x{pl + 1:02x}")
    print("};")


if __name__ == "__main__":
    main()
