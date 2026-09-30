"""Derive the cue sheet (assets/lib/cues.js, CUES block) from the voiceover anchors.

    python3 build/sync-cues.py      (from video/, after `python3 build/vo.py --anchors`)

Each scene starts a fixed lead before its first spoken anchor; beats land LEAD_IN before
the word they belong to, so the picture leads the voice. Scene length runs to the next
scene's start. The SFX block in cues.js is left untouched.
"""

import json
import re
from pathlib import Path

A = json.loads(Path("assets/vo/anchors.json").read_text())
LEAD_IN = 0.1


def beats(scene, start, names):
    return {n: round(A[scene][n] - start - LEAD_IN, 2) for n in names}


starts = {
    "s01": 0.0,
    "s02": A["s02"]["what"] - 0.4,
    "s03": A["s03"]["one"] - 2.02,  # the egg hatches and the world opens before "From now on"
    "s04": A["s04"]["thrive"] - 0.48,
    "s05": A["s05"]["buffer"] - 0.72,
    "s06": A["s06"]["payday"] - 0.56,
    "s07": A["s07"]["hood"] - 0.42,
    "s08": A["s08"]["explain"] - 0.81,
    "s09": A["s09"]["sofie"] - 0.64,
    "s10": A["s10"]["name"] - 1.12,
}
end = A["s10"]["alive"] + 5.1  # the lockup holds, then fades

cues = {}
order = list(starts)
for i, s in enumerate(order):
    st = round(starts[s], 2)
    nxt = round(starts[order[i + 1]], 2) if i + 1 < len(order) else round(end, 2)
    b = {}
    if s == "s01":
        b = beats(s, st, ["app", "coffee", "grocery", "late", "tells", "after"])
    elif s == "s02":
        b = beats(s, st, ["what", "meet", "plume", "tab", "challenge", "fund", "optin", "hatch"])
        b["card"] = round(b["plume"] + 0.45, 2)
        b["tapCard"] = round(b["challenge"] - 1.0, 2)
    elif s == "s03":
        b = {"crack": 0.25, "world": 1.6, "one": round(A[s]["one"] - st + 0.88, 2)}
        b.update(beats(s, st, ["today", "no"]))
        b["learned"] = round(A[s]["learn"] - st - LEAD_IN, 2)
    elif s == "s04":
        b = beats(s, st, ["thrive", "turns", "tired", "sick", "dies", "bad", "habit"])
        b["dead"] = round(A[s]["diesword"] - st - LEAD_IN, 2)
    elif s == "s05":
        b = beats(s, st, ["buffer", "life", "laptop", "catches", "not", "cant", "earn"])
    elif s == "s06":
        b = beats(s, st, ["payday", "lake", "passive"])
        b["dive"] = round(nxt - st - 1.0, 2)
    elif s == "s07":
        b = beats(s, st, ["hood", "nobox", "history", "aside", "noise", "because", "baseline", "saturday", "save", "cap", "freeze"])
    elif s == "s08":
        b = beats(s, st, ["explain", "api", "push", "pull", "optin", "det", "del"])
    elif s == "s09":
        b = beats(s, st, ["sofie", "lucas", "works", "emma", "jonas", "four"])
    elif s == "s10":
        b = beats(s, st, ["name", "kbc", "intent", "alive"])
    cues[s] = {"start": st, "dur": round(nxt - st, 2), "b": b}

lines = ["window.CUES = {"]
for s, c in cues.items():
    bb = ", ".join(f"{k}: {v}" for k, v in c["b"].items())
    lines.append(f"  {s}: {{ start: {c['start']}, dur: {c['dur']}, b: {{ {bb} }} }},")
lines.append("}")
block = "\n".join(lines) + "\n"

p = Path("assets/lib/cues.js")
src = p.read_text()
src = re.sub(r"window\.CUES = \{.*?\n\}\n", lambda m: block, src, count=1, flags=re.S)
p.write_text(src)
print(block)
print(f"total {end:.2f}s")
