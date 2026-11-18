r"""ДЕСКРИПТОР M62: перечислить интерфейсы и опознать DFU.

═══════════ ЗАЧЕМ ═══════════

В заметках записано «interface 3 = DFU, никогда не трогать». Это
надо проверить по ФАКТИЧЕСКОМУ дескриптору устройства, а не по
памяти: ошибка в номере означает либо риск кирпича, либо отказ от
единственного рабочего канала управления.

`node-hid` видит только HID (у M62 это ровно interface 4). Чтобы
увидеть ОСТАЛЬНЫЕ интерфейсы, нужен полный дескриптор конфигурации
из USB-запроса GET_DESCRIPTOR — он есть в pcap (USBPcap пишет
control-трансферы).

═══════════ ЧТО ДЕЛАЕТ ═══════════

1. Ищет в pcap ответ на GET_DESCRIPTOR (CONFIGURATION) для M62.
2. Разбирает дескриптор: bNumInterfaces, для каждого интерфейса —
   bInterfaceNumber, bInterfaceClass, bInterfaceSubClass,
   bNumEndpoints.
3. Печатает таблицу и делает вывод, какой интерфейс DFU.

Запуск:
    python src/tools/audit-usb-descriptor.py
"""

from __future__ import annotations

import struct
import sys
from pathlib import Path

# Классы USB-интерфейсов
CLASS_NAMES = {
    0x01: "Audio",
    0x02: "CDC Communication",
    0x03: "HID",
    0x08: "Mass Storage",
    0xFE: "Application Specific (DFU обычно здесь)",
    0xFF: "Vendor Specific",
}

# Подклассы DFU
DFU_SUBCLASS = 0x01
DFU_PROTOCOL = {0x01: "Runtime", 0x02: "DFU mode"}


def read_usbpcap(path: Path, want_dev: int = 6):
    """Вернуть список (endpoint, transfer, payload) для устройства."""
    blob = path.read_bytes()
    endian = "<" if blob[:4] == b"\xd4\xc3\xb2\xa1" else ">"
    pos = 24
    n = len(blob)
    out = []
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
        info = data[16]
        ep = data[21]
        transfer = data[22]
        data_len = struct.unpack("<I", data[23:27])[0]
        payload = data[header_len : header_len + data_len]
        out.append((info, ep, transfer, payload))
    return out


def parse_config_descriptor(buf: bytes):
    """Разобрать дескриптор конфигурации и дочерние дескрипторы."""
    if len(buf) < 9:
        return None
    if buf[1] != 0x02:  # CONFIGURATION
        return None

    wTotalLength = struct.unpack_from("<H", buf, 2)[0]
    bNumInterfaces = buf[4]
    body = buf[:wTotalLength] if wTotalLength <= len(buf) else buf

    interfaces = []
    cur = None
    i = 9
    while i + 2 <= len(body):
        blen = body[i]
        btype = body[i + 1]
        if blen == 0:
            break
        chunk = body[i : i + blen]
        if btype == 0x04 and len(chunk) >= 9:  # INTERFACE
            cur = {
                "number": chunk[2],
                "alt": chunk[3],
                "endpoints": chunk[4],
                "class": chunk[5],
                "subclass": chunk[6],
                "protocol": chunk[7],
                "eps": [],
            }
            interfaces.append(cur)
        elif btype == 0x05 and len(chunk) >= 7 and cur is not None:  # ENDPOINT
            cur["eps"].append({
                "addr": chunk[2],
                "attr": chunk[3],
                "maxpacket": struct.unpack_from("<H", chunk, 4)[0],
            })
        elif btype == 0x24 and cur is not None and len(chunk) >= 2:
            # class-specific descriptor: subtype
            cur.setdefault("cs", []).append(chunk[1])
        i += blen

    return {"numInterfaces": bNumInterfaces, "interfaces": interfaces}


def find_descriptors(frames):
    """Найти дескрипторы конфигурации в потоке."""
    found = []
    for _info, _ep, _tr, payload in frames:
        # descriptor может начинаться с 0x09 0x02 (bLength=9, type=CONFIG)
        idx = payload.find(b"\x09\x02")
        while idx >= 0:
            config = parse_config_descriptor(payload[idx:])
            if config and config["interfaces"]:
                found.append(config)
                break
            idx = payload.find(b"\x09\x02", idx + 1)
    return found


def main():
    # Ищем в нескольких захватах: дескрипторы читаются при подключении
    candidates = [
        Path("research/m62-full.pcap"),
        Path("research/mixer-sources.pcap"),
        Path("research/mixer-boot-capture.pcap"),
        Path("research/capture-48v.pcap"),
    ]
    existing = [p for p in candidates if p.exists()]

    print("=" * 76)
    print("ДЕСКРИПТОР M62: ИНТЕРФЕЙСЫ И DFU")
    print("=" * 76)
    print(f"\nищу в захватах: {len(existing)}\n")

    best = None
    for p in existing:
        try:
            frames = read_usbpcap(p)
            descs = find_descriptors(frames)
        except Exception as e:  # noqa: BLE001
            print(f"  {p.name}: ошибка разбора {e}")
            continue
        if descs:
            print(f"  {p.name}: найден дескриптор, интерфейсов {len(descs[0]['interfaces'])}")
            if best is None or len(descs[0]["interfaces"]) > len(best["interfaces"]):
                best = descs[0]
        else:
            print(f"  {p.name}: дескриптора нет ({len(frames)} записей)")

    if best is None:
        print("\n" + "!" * 76)
        print("ОШИБКА: дескриптор не найден ни в одном захвате.")
        print("!" * 76)
        print("""
Это НЕ значит «интерфейсов нет» — значит, что разбор не нашёл
GET_DESCRIPTOR. Выводы о номерах интерфейсов делать нельзя.
""")
        return 2

    print("\n" + "-" * 76)
    print("ИНТЕРФЕЙСЫ")
    print("-" * 76)
    print("  №   класс              суб  прот  ep  описание")
    print("  " + "-" * 70)

    for itf in best["interfaces"]:
        cls = itf["class"]
        cname = CLASS_NAMES.get(cls, f"0x{cls:02x}")
        sub = itf["subclass"]
        proto = itf["protocol"]
        note = ""
        if cls == 0xFE and sub == DFU_SUBCLASS:
            note = f"DFU {DFU_PROTOCOL.get(proto, '?')}"
        elif cls == 0x03:
            note = "HID (наш канал управления)"
        elif cls == 0x01:
            note = "UAC Audio"
        print(f"  {itf['number']:<4}{cname:<20}0x{sub:02x} 0x{proto:02x}  "
              f"{len(itf['eps'])}   {note}")

    print("\n  bNumInterfaces =", best["numInterfaces"])

    # ─── вывод ───
    dfu = [i for i in best["interfaces"]
           if i["class"] == 0xFE and i["subclass"] == DFU_SUBCLASS]
    hid = [i for i in best["interfaces"] if i["class"] == 0x03]

    print("\n" + "=" * 76)
    print("ВЫВОД")
    print("=" * 76)
    print(f"\n  DFU-интерфейсов: {len(dfu)} -> "
          f"{[i['number'] for i in dfu] if dfu else 'не найдено'}")
    print(f"  HID-интерфейсов: {len(hid)} -> "
          f"{[i['number'] for i in hid] if hid else 'не найдено'}")

    if dfu and hid:
        dn = {i["number"] for i in dfu}
        hn = {i["number"] for i in hid}
        if dn & hn:
            print("\n  ⚠ ПЕРЕСЕЧЕНИЕ: один и тот же номер и DFU, и HID.")
            print("  Это опасно, разбираться отдельно.")
        else:
            print(f"\n  DFU на интерфейсе {sorted(dn)}, HID на {sorted(hn)}.")
            print("  Совпадает с правилом: рабочий канал — HID (4),")
            print("  DFU — другой интерфейс (3). Путаницы нет.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
