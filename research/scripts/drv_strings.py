import re, sys

for path in (r"C:\Program Files\TOPPING Pro\USB Audio Device Driver\x64\ToppingProUsbAudio.sys",
             r"C:\Program Files\TOPPING Pro\USB Audio Device Driver\x64\ToppingProUsbAudioapi_x64.dll",
             r"C:\Program Files\TOPPING Pro\USB Audio Device Driver\x64\ToppingProUsbAudioapi.dll"):
    data = open(path, "rb").read()
    print("===", path, len(data))
    ss = [m.group().decode("latin-1") for m in re.finditer(rb"[\x20-\x7e]{6,}", data)]
    keep = [s for s in ss if re.search(r"(?i)ioctl|control|topping|M62|KB22|firmware|dsp|peq|reverb|noise|compress|duck|vendor|pipe|endpoint|interface", s)]
    for s in keep[:150]:
        print("   ", s)
    print("   total strings", len(ss), "kept", len(keep))
