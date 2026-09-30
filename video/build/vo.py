"""Edit the recorded voiceover and map the beat anchors to video time.

    python3 build/vo.py              (from video/)   writes assets/vo/vo.wav
    python3 build/vo.py --anchors                    writes assets/vo/anchors.json

Two takes:
- raw.m4a: the full read ("Voice recording.m4a")
- fix.m4a: blocks [02] and [10] re-read with the new name, Plume ("Fix recording.m4a")

The edit keeps the ranges in EDIT, drops the false start before "Sophie saves every payday",
tightens over-long pauses and inserts breathing gaps (GAPS) so pictures can land with no voice.
15 ms fades at every cut, per-take gain so the two takes match, then a light voice chain:
high-pass, gentle denoise, compression, loudness to -16 LUFS.
"""

import json
import subprocess
import sys
from pathlib import Path

VO = Path("assets/vo")
LEAD = 0.4  # the voice starts 0.4 s into the video
FADE = 0.015
TAKES = {"raw": "raw.m4a", "fix": "fix.m4a"}
GAIN = {"raw": 0.0, "fix": 5.3}  # dB: the fix take's block [02] was recorded ~5 dB quieter

# (take, start, end[, gain dB]) or ("gap", seconds)
EDIT = [
    ("raw", 0.00, 9.30),  # [01] the boring bank
    ("gap", 0.7),
    ("fix", 0.60, 14.75),  # [02] "What if your bank could help you before? Meet Plume..." (fix take)
    ("raw", 26.40, 51.95),  # [03]-[04]
    ("raw", 52.75, 107.60),  # [05]-[07]
    ("raw", 108.70, 123.00),  # [08] ... "deletes everything."
    ("raw", 127.30, 140.70),  # [09]: the false start "Sophie. ..." (123-127 s) is dropped
    ("fix", 17.95, 22.848, 0.2),  # [10] "Plume, for KBC. Spend with intent. Keep your swan alive." (fix take)
    ("gap", 0.8),
]
# Breathing room inserted at these raw-take times (always inside a pause).
GAPS = {
    26.70: 1.2, 37.45: 0.8, 47.82: 1.0, 51.95: 2.5,  # [03]-[04]
    63.13: 0.6, 67.98: 1.8, 72.14: 0.6, 76.77: 0.6,  # [05]-[06]
    80.16: 0.8, 82.31: 1.2, 85.18: 1.5, 90.94: 1.5, 93.81: 0.6, 96.89: 1.5, 102.72: 1.5, 107.60: 2.0,  # [07]
    112.11: 1.5, 114.52: 0.6, 119.00: 0.5, 123.00: 1.5,  # [08]
    132.80: 0.5, 140.29: 1.0,  # [09]
}


def edit_list():
    """EDIT with the raw ranges split at the gap points: [(take, a, b, gain) | ('gap', s)]."""
    out = []
    for e in EDIT:
        if e[0] == "gap":
            out.append(e)
            continue
        take, a, b = e[:3]
        gain = e[3] if len(e) > 3 else GAIN[take]
        cuts = sorted(t for t in GAPS if a < t <= b) if take == "raw" else []
        start = a
        for t in cuts:
            out.append((take, start, t, gain))
            out.append(("gap", GAPS[t]))
            start = t
        if start < b:
            out.append((take, start, b, gain))
    return out


def to_video(take: str, t: float) -> float | None:
    """Where a moment of a take lands in the video (seconds)."""
    out = LEAD
    for e in edit_list():
        if e[0] == "gap":
            out += e[1]
            continue
        k, a, b, _ = e
        if k == take and a <= t < b:
            return out + (t - a)
        out += b - a
    return None


def render():
    inputs = []
    for f in TAKES.values():
        inputs += ["-i", str(VO / f)]
    idx = {k: i for i, k in enumerate(TAKES)}
    parts, labels = [], []
    for i, e in enumerate(edit_list()):
        if e[0] == "gap":
            parts.append(f"anullsrc=r=44100:cl=mono,atrim=duration={e[1]}[p{i}]")
        else:
            k, a, b, gain = e
            d = b - a
            parts.append(
                f"[{idx[k]}:a]atrim={a}:{b},asetpts=PTS-STARTPTS,aresample=44100,aformat=channel_layouts=mono,"
                f"volume={gain}dB,afade=t=in:d={FADE},afade=t=out:st={d - FADE:.3f}:d={FADE}[p{i}]"
            )
        labels.append(f"[p{i}]")
    chain = (
        f"{''.join(labels)}concat=n={len(labels)}:v=0:a=1,"
        "highpass=f=80,afftdn=nf=-28,"
        "acompressor=threshold=-21dB:ratio=3:attack=6:release=90:makeup=2,"
        f"adelay={int(LEAD * 1000)}:all=1,"
        "loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[out]"
    )
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *inputs,
           "-filter_complex", ";".join(parts + [chain]),
           "-map", "[out]", "-ac", "1", "-c:a", "pcm_s16le", str(VO / "vo.wav")]
    subprocess.run(cmd, check=True)
    total = sum(e[1] if e[0] == "gap" else e[2] - e[1] for e in edit_list()) + LEAD
    print(f"vo.wav {total:.2f}s")


# Beat anchors: where each voiceover phrase starts in its take (speech onsets from
# silencedetect, cross-checked with the whisper transcript).
ANCHORS = {
    "s01": ("raw", {"app": 1.24, "coffee": 3.10, "grocery": 3.84, "late": 4.90, "tells": 6.03, "after": 7.60}),
    "s02": ("fix", {"what": 0.70, "meet": 3.23, "plume": 4.01, "tab": 4.72, "challenge": 7.97, "fund": 9.05, "optin": 11.84, "hatch": 13.73}),
    "s03": ("raw", {"one": 27.22, "today": 29.60, "no": 32.12, "learned": 33.72, "learn": 35.16}),
    "s04": ("raw", {"thrive": 38.08, "turns": 40.00, "tired": 43.04, "sick": 44.75, "dies": 45.52, "diesword": 47.23, "bad": 48.07, "habit": 50.06}),
    "s05": ("raw", {"buffer": 53.12, "life": 56.04, "laptop": 57.87, "catches": 59.84, "not": 61.60, "cant": 62.96, "earn": 64.90}),
    "s06": ("raw", {"payday": 68.56, "lake": 72.41, "passive": 73.75}),
    "s07": ("raw", {"hood": 77.62, "nobox": 79.04, "history": 80.38, "aside": 82.47, "noise": 85.36, "because": 87.90, "baseline": 91.17,
                    "saturday": 94.09, "save": 97.27, "cap": 100.48, "freeze": 102.92}),
    "s08": ("raw", {"explain": 109.11, "api": 112.31, "push": 114.93, "pull": 116.39, "optin": 117.92, "det": 119.33, "del": 120.42}),
    "s09": ("raw", {"sofie": 127.64, "lucas": 129.22, "works": 131.94, "emma": 132.97, "jonas": 135.36, "four": 137.88}),
    "s10": ("fix", {"name": 18.16, "kbc": 18.86, "intent": 20.00, "alive": 21.35}),
}

if __name__ == "__main__":
    if "--anchors" in sys.argv:
        mapped = {s: {k: round(to_video(take, v), 2) for k, v in a.items()} for s, (take, a) in ANCHORS.items()}
        (VO / "anchors.json").write_text(json.dumps(mapped, indent=1))
        for s, a in mapped.items():
            print(s, a)
    else:
        render()
