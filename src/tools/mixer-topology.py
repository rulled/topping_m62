r"""Детальный разбор: какое свойство = какой источник микшера.

═══════════ ПРОБЛЕМА ═══════════

Матрица в захвате неоднозначна:

    0x33 (Mix B L): ненулевые 0x01,0x03,0x05,0x07,0x09,0x0a,0x0b,0x0f,0x11,0x13
    0x34 (Mix B R): ненулевые 0x02,0x04,0x06,0x08,0x09,0x0a,0x0c,0x10,0x12,0x14

Заметьте: 0x09 и 0x0a ненулевые в ОБЕИХ группах, а остальные разнесены
по чётности. Значит 0x09/0x0a — не пара L/R одного источника, а что-то
особое (возможно два моно-источника или служебные ячейки).

═══════════ ЧТО ДЕЛАЕТ ЭТОТ СКРИПТ ═══════════

Строит три гипотезы разметки свойств и проверяет их согласованность
с workspace-INI (какие источники видны в каком миксе):

  H1: 0x01/0x02 = ист.1, 0x03/0x04 = ист.2, ... (пары L/R)
  H2: 0x01..0x0a = ист.1..10 в L, 0x0b..0x14 = ист.1..10 в R
  H3: смешанная (0x01..0x08 пары, дальше иначе)

Для каждой — сколько источников получается и совпадает ли с INI.

Запуск: python src/tools/mixer-topology.py <файл.pcap> [dev]
"""

from __future__ import annotations

import struct
import sys
from pathlib import Path

MAGIC_HEAD = b"\x22\x33"
MAGIC_TAIL = b"\x66\x77"
FRAME_LEN = 15
Q25_UNITY = 2**25

INI = Path(
    r"C:\Program Files\TOPPING Pro\M Control Center\Workspace\M62\Live\M62_Live_main.ini"
)


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


def read_ini_mixer():
    """Возвращает {секция: {MixX_GAIN, MixX_MUTE}}."""
    if not INI.exists():
        return {}
    txt = INI.read_text(encoding="utf-8-sig")
    out = {}
    cur = None
    for line in txt.splitlines():
        t = line.strip()
        if t.startswith("["):
            name = t[1:-1]
            if name.startswith("Mixer_"):
                cur = name
                out[cur] = {}
            else:
                cur = None
            continue
        if not cur or not t:
            continue
        eq = t.find("=")
        if eq > 0:
            out[cur][t[:eq].strip()] = t[eq + 1 :].strip()
    return out


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("использование: mixer-topology.py <файл.pcap> [dev]")
    path = sys.argv[1]
    dev = int(sys.argv[2]) if len(sys.argv) > 2 else 6

    mixer: dict[int, dict[int, int]] = {}
    for ep, payload in read_packets(path, dev):
        if ep & 0x80:
            continue
        for tt, pp, value in frames(payload):
            if 0x31 <= tt <= 0x3C:
                mixer.setdefault(tt, {})[pp] = value

    if not mixer:
        print("микшера в OUT не найдено")
        return

    groups = sorted(mixer)
    print(f"групп: {len(groups)} -> {', '.join(f'0x{g:02x}' for g in groups)}")
    print(f"свойств на группу: {len(mixer[groups[0]])}")

    # ---------- какие свойства ненулевые в каждой группе ----------
    print("\n=== ненулевые свойства по группам ===")
    for g in groups:
        nz = sorted(p for p, v in mixer[g].items() if v)
        if not nz:
            print(f"  0x{g:02x}: (всё mute)")
            continue
        vals = " ".join(
            f"0x{p:02x}={'-inf' if mixer[g][p] == 0 else f'{20 * __import__("math").log10(mixer[g][p] / Q25_UNITY):+.1f}'}"
            for p in nz
        )
        print(f"  0x{g:02x}: {vals}")

    # ---------- гипотезы ----------
    print("\n=== ГИПОТЕЗЫ РАЗМЕТКИ ===")

    # H1: пары L/R -> 10 источников
    print("\nH1: 0x01/0x02 = ист.1L/R, 0x03/0x04 = ист.2L/R, ... (10 источников)")
    for g in groups:
        if g % 2 == 1:  # L-группа
            r = g + 1
            if r not in mixer:
                continue
            active = set()
            for p in range(1, 21):
                if mixer[g].get(p) or mixer[r].get(p):
                    active.add((p + 1) // 2)
            if active:
                print(f"  0x{g:02x}/0x{r:02x}: источники {sorted(active)}")

    # H2: 0x01..0x0a = L, 0x0b..0x14 = R
    print("\nH2: 0x01..0x0a = ист.1..10 L, 0x0b..0x14 = ист.1..10 R")
    for g in groups:
        nz = sorted(p for p, v in mixer[g].items() if v)
        if not nz:
            continue
        low = [p for p in nz if p <= 0x0A]
        high = [p for p in nz if p >= 0x0B]
        print(f"  0x{g:02x}: L-часть {[f'0x{p:02x}' for p in low]}  R-часть {[f'0x{p:02x}' for p in high]}")

    # ---------- сверка с INI ----------
    print("\n=== СВЕРКА С INI ===")
    ini = read_ini_mixer()
    if not ini:
        print("  INI недоступен")
        return
    for section, kv in ini.items():
        gains = {k: v for k, v in kv.items() if k.endswith("_GAIN")}
        print(f"  {section}: {gains}")

    print("\n  трактовка: GAIN в INI — это ДЕЛЬТА от unity.")
    print("  В захвате 0 dB = 33554432, -6 dB = 16777216.")
    print("  Если в INI GAIN=0, а в захвате -6 dB, значит дефолт источника -6,")
    print("  и пользователь его не менял.")

    # ---------- особые свойства 0x09/0x0a ----------
    print("\n=== ОСОБЫЕ СВОЙСТВА 0x09 / 0x0a ===")
    for g in groups:
        v9 = mixer[g].get(0x09)
        va = mixer[g].get(0x0A)
        if v9 or va:
            print(f"  0x{g:02x}: 0x09={v9} ({(v9 / Q25_UNITY):.4f} unity)  0x0a={va} ({(va / Q25_UNITY):.4f})")
    print("  одинаковое значение в L и R -> это НЕ пара каналов, а общая ячейка")


if __name__ == "__main__":
    main()
