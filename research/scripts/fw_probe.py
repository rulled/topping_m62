import os, struct, binascii

files = [
    r"E:\Programming shit\Topping\research\firmware\M62_FW87.05.45.48.27\M62_FW87.05.45.48.27.bin",
    r"E:\Programming shit\Topping\research\firmware\KB22_FW49_07_19_20_20\KB22_FW49_07_19_20_20.Topping",
]

for p in files:
    d = open(p, "rb").read()
    print("=" * 70)
    print(os.path.basename(p), len(d), "bytes")
    print("head 64 :", binascii.hexlify(d[:64], " ").decode())
    print("tail 32 :", binascii.hexlify(d[-32:], " ").decode())
    # entropy-ish: count distinct bytes
    print("distinct byte values:", len(set(d)))
    # find ascii strings
    import re
    strs = [m.group().decode("ascii", "replace") for m in re.finditer(rb"[\x20-\x7e]{5,}", d)]
    print("ascii strings:", len(strs))
    for s in strs[:40]:
        print("   ", s[:100])
    print()
