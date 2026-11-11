#!/usr/bin/env python3
"""Find where each script line starts/ends inside the take -> vo/lines.json

  python align.py vo/takeA.mp3            (needs script.md + vo/words.json from transcribe.py)

1) every recognised character gets a time (spread across its word)
2) difflib matches script characters to recognised characters (digits/typos just stay unmatched)
3) each line's first/last matched character gives start/end, snapped to the nearest silence edge
It must print `overlaps: 0`; check each start against the transcript (±0.3 s).
If a line starts mid-sentence on screen later, the split is wrong: fix t/end of that line in vo/lines.json by hand
(find real gaps with: python tools.py gap vo/takeA.mp3 <t0> <t1>) and re-run splice.py.
"""
import re
import subprocess
import sys
from difflib import SequenceMatcher

from common import dump, duration, load, need, read_script


def keep(s: str) -> str:
    return re.sub(r"[^฀-๿a-zA-Z]", "", s).replace("ๆ", "").lower()


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    take = sys.argv[1]
    lines = read_script()
    wc, wt = [], []
    for w in load("vo/words.json")["words"]:
        c = keep(w["w"])
        for i, ch in enumerate(c):
            wc.append(ch)
            wt.append(w["s"] + (w["e"] - w["s"]) * (i + 0.5) / len(c))
    sc, owner = [], []
    for i, l in enumerate(lines):
        c = keep(l["th"])
        sc += list(c)
        owner += [i] * len(c)
    m = {}
    for blk in SequenceMatcher(None, "".join(sc), "".join(wc), autojunk=False).get_matching_blocks():
        for k in range(blk.size):
            m[blk.a + k] = blk.b + k
    err = subprocess.run([need("ffmpeg"), "-i", take, "-af", "silencedetect=n=-38dB:d=0.1", "-f", "null", "-"], capture_output=True, text=True).stderr
    ss = [float(x) for x in re.findall(r"silence_start: ([\d.]+)", err)] or [0.0]
    se = [0.0] + [float(x) for x in re.findall(r"silence_end: ([\d.]+)", err)]
    found = {}
    for i in range(len(lines)):
        idx = [k for k, o in enumerate(owner) if o == i and k in m]
        # a handful of stray matching letters is not the line: need a third of it
        if idx and len(idx) >= 0.3 * owner.count(i):
            found[i] = (wt[m[idx[0]]], wt[m[idx[-1]]])
    # lines must follow each other; one that starts before the line in front of it ends was matched in the wrong place
    last = -1.0
    for i in sorted(found):
        a, b = found[i]
        if a < last - 0.15 or b <= a:
            del found[i]
        else:
            last = b
    if not found:
        sys.exit("no line found in the transcript - check the take")
    # a line Whisper garbled gets its time from its neighbours, shared out by length (a picture slightly off beats no clip)
    total = duration(take)
    size = [max(1, len(keep(l["th"]))) for l in lines]
    estimated = []
    i = 0
    while i < len(lines):
        if i in found:
            i += 1
            continue
        j = i
        while j < len(lines) and j not in found:
            j += 1
        lo = found[i - 1][1] + 0.1 if i > 0 else 0.0
        hi = found[j][0] - 0.1 if j < len(lines) else total
        span = sum(size[i:j])
        cur = lo
        for k in range(i, j):
            nxt = cur + (hi - cur) * size[k] / span if span else hi
            span -= size[k]
            found[k] = (cur + 0.05, nxt - 0.05)
            estimated.append(k + 1)
            cur = nxt
        i = j
    for i, l in enumerate(lines):
        a, b = found[i]
        l["t"] = round(min(se, key=lambda x: abs(x - a) + (0.5 if x > a + 0.15 else 0)), 2)
        l["end"] = round(min(ss, key=lambda x: abs(x - b) + (0.5 if x < b - 0.15 else 0)), 2)
        if l["end"] <= l["t"]:
            l["t"], l["end"] = round(a, 2), round(b, 2)
    # a start snapped onto a pause inside the line before: move it to the first pause after that line ends
    for i in range(1, len(lines)):
        prev, l = lines[i - 1], lines[i]
        if l["t"] < prev["end"]:
            after = [x for x in se if prev["end"] <= x < l["end"]]
            l["t"] = round(after[0] if after else prev["end"] + 0.05, 2)
            if l["end"] <= l["t"]:
                l["end"] = round(l["t"] + 0.3, 2)
    dump("vo/lines.json", {"take": take, "lines": lines})
    bad = 0
    for i, l in enumerate(lines, 1):
        flag = "  <-- overlaps previous" if i > 1 and l["t"] < lines[i - 2]["end"] else ""
        bad += bool(flag)
        print(f"{i:2d} {l['t']:6.2f} {l['end']:6.2f} {l['th']}{flag}")
    print("overlaps:", bad)
    print("estimated:", " ".join(map(str, estimated)) or "none")


if __name__ == "__main__":
    main()
