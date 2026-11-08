import re

p = r"E:\Programming shit\Topping\research\firmware\KB22_FW49_07_19_20_20\KB22_FW49_07_19_20_20.Topping"
d = open(p, "rb").read()

# The UI string cluster is around 0x12a5de. Dump a wide window as text.
for start, end, label in [
    (0x12a400, 0x12b400, "UI string cluster"),
]:
    print("=== %s  %08x-%08x ===" % (label, start, end))
    sub = d[start:end]
    # print all printable runs >=4
    for m in re.finditer(rb"[\x20-\x7e]{4,}", sub):
        print("   %08x  %r" % (start + m.start(), m.group().decode("ascii")))

print()
print("=== search for firmware version string 49.07.19 or 490719 ===")
for pat in [b"49.07.19", b"490719", b"87.05.45", b"870545"]:
    for m in re.finditer(re.escape(pat), d):
        print("   %s at %08x" % (pat.decode(), m.start()))

print()
print("=== look for known KB22 UI keywords anywhere in file ===")
for kw in [b"Crossfeed", b"Cross", b"feed", b"Expander", b"Expand", b"Vocal", b"Spatial",
           b"Studio", b"PingPong", b"Ducking", b"Reverb", b"Echo", b"PEQ", b"HIFI", b"Game",
           b"Delay", b"Feedback", b"Noise", b"Volume", b"Firmware", b"Update"]:
    offs = [m.start() for m in re.finditer(re.escape(kw), d)]
    print("   %-12s %d hits %s" % (kw.decode(), len(offs), [hex(o) for o in offs[:6]]))
