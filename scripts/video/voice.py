#!/usr/bin/env python3
"""Splits ONE voice recording into its spoken lines and writes a plan that fits the footage to that voice.

  python3 scripts/video/voice.py <voice file> <plan.json> <out plan.json> [--gap 1.5] [--noise -35] [--drop 3,7]

The speaker leaves a few seconds of silence between lines, so the lines are found by their silences. The voice is
cleaned (rumble and hiss reduced), made evenly loud, and never stretched or re-timed: the footage is fitted to it.
--drop takes the numbers of takes to throw away (a line said twice), counted in the order they were spoken.
"""
import json, os, re, subprocess, sys

def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        sys.stderr.write(" ".join(cmd)[:800] + "\n" + r.stderr[-1200:] + "\n"); raise SystemExit(1)
    return r

def duration(path):
    return float(run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path]).stdout.strip())

def main():
    args = sys.argv[1:]
    voice, plan_in, plan_out = args[0], args[1], args[2]
    opt = lambda name, default: (args[args.index(name) + 1] if name in args else default)
    gap, noise = float(opt("--gap", "1.5")), float(opt("--noise", "-35"))
    drop = {int(x) for x in opt("--drop", "").split(",") if x}
    work = os.path.splitext(plan_out)[0] + "-voice"; os.makedirs(work, exist_ok=True)

    # 1. Mono, rumble removed. Find the loudest peak so the silence threshold is relative to this recording.
    mono = f"{work}/mono.wav"
    run(["ffmpeg", "-y", "-i", voice, "-af", "highpass=f=70", "-ar", "48000", "-ac", "1", mono])
    peak = float(re.search(r"max_volume: (-?[0-9.]+) dB", run(["ffmpeg", "-i", mono, "-af", "volumedetect", "-f", "null", "-"]).stderr).group(1))
    total = duration(mono)

    # 2. The silences between lines.
    err = run(["ffmpeg", "-i", mono, "-af", f"silencedetect=noise={peak + noise:.1f}dB:d={gap}", "-f", "null", "-"]).stderr
    starts = [float(x) for x in re.findall(r"silence_start: (-?[0-9.]+)", err)]
    ends = [float(x) for x in re.findall(r"silence_end: (-?[0-9.]+)", err)]
    if len(ends) < len(starts): ends.append(total)
    speech, t = [], 0.0
    for s, e in zip(starts, ends):
        if s - t > 0.35: speech.append((t, s))
        t = e
    if total - t > 0.35: speech.append((t, total))
    print(f"recording {total:.1f}s, peak {peak:.1f} dB, {len(speech)} spoken takes found:")
    for n, (a, b) in enumerate(speech, 1): print(f"  take {n:2d}: {a:6.1f}s to {b:6.1f}s  ({b - a:4.1f}s){'   DROPPED' if n in drop else ''}")
    keep = [x for n, x in enumerate(speech, 1) if n not in drop]

    plan = json.load(open(plan_in)); plan.pop("silent", None)
    if len(keep) != len(plan["segments"]):
        print(f"\nNOT WRITTEN: the plan has {len(plan['segments'])} lines but {len(keep)} takes are kept. Use --drop, --gap or --noise."); raise SystemExit(2)

    # 3. Cut each line with a little air around it, reduce hiss, fade the edges.
    raw = []
    for n, (a, b) in enumerate(keep, 1):
        a2, b2 = max(0.0, a - 0.12), min(total, b + 0.18); d = b2 - a2
        f = f"{work}/raw-{n:02d}.wav"
        run(["ffmpeg", "-y", "-ss", f"{a2:.3f}", "-t", f"{d:.3f}", "-i", mono, "-af", f"afftdn=nf=-25,afade=t=in:d=0.04,afade=t=out:st={max(0, d - 0.12):.3f}:d=0.12", f])
        raw.append(f)
    # 4. One gain for every line, so the whole narration sits at broadcast-style loudness without pumping.
    lst = f"{work}/all.txt"; open(lst, "w").write("".join(f"file '{os.path.abspath(f)}'\n" for f in raw))
    allf = f"{work}/all.wav"; run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", allf])
    m = re.search(r'"input_i"\s*:\s*"(-?[0-9.]+)"', run(["ffmpeg", "-i", allf, "-af", "loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"]).stderr)
    gain = max(-12.0, min(24.0, -16.0 - float(m.group(1)))) if m else 0.0
    for n, (seg, f) in enumerate(zip(plan["segments"], raw), 1):
        out = f"{work}/line-{n:02d}.wav"
        run(["ffmpeg", "-y", "-i", f, "-af", f"volume={gain:.2f}dB,alimiter=limit=0.89:level=false", "-ar", "48000", "-ac", "2", out])
        seg["audio"] = out; seg.pop("length", None)
    json.dump(plan, open(plan_out, "w"), indent=1)
    spoken = sum(duration(s["audio"]) for s in plan["segments"])
    print(f"\ngain applied {gain:+.1f} dB; spoken time {spoken:.1f}s; wrote {plan_out}")

main()
