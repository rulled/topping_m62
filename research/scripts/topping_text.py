import re

p = r"E:\Programming shit\Topping\research\firmware\KB22_FW49_07_19_20_20\KB22_FW49_07_19_20_20.Topping"
d = open(p, "rb").read()

# Looking for REAL words: require a run containing at least 2 lowercase-letter words
# and at least one vowel, to filter runs of identical characters.
def looks_like_text(s):
    if len(s) < 6:
        return False
    if len(set(s)) < 4:
        return False
    letters = sum(c.isalpha() for c in s)
    if letters < len(s) * 0.7:
        return False
    vowels = sum(c in "aeiouAEIOU" for c in s)
    if vowels < 2:
        return False
    # reject strings dominated by one char
    from collections import Counter
    top = Counter(s).most_common(1)[0][1]
    return top <= len(s) * 0.4

for a, b, label in [(0x000000, len(d), "whole file")]:
    sub = d[a:b]
    seen = set()
    hits = []
    for m in re.finditer(rb"[\x20-\x7e]{6,}", sub):
        s = m.group().decode("ascii")
        if looks_like_text(s) and s not in seen:
            seen.add(s)
            hits.append((a + m.start(), s))
    print("=== %s : %d candidates ===" % (label, len(hits)))
    for off, s in hits[:120]:
        print("   %08x  %s" % (off, s[:100]))
