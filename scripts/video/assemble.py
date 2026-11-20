#!/usr/bin/env python3
"""Assembles a demo video from REAL screen recordings of the live product, with captions and a synthetic voice.

  python3 scripts/video/assemble.py <plan.json> <out.mp4>

plan.json: { "voice": "Samantha", "rate": 175, "segments": [ { "clip": "path.webm" | null, "card": "text for a title card" | null,
             "start": seconds into the clip, "say": "narration", "caption": "optional on-screen caption" } ] }

Every clip is footage recorded by tests/e2e/record.ts or tests/e2e/journey.ts against the deployed app. This script only
trims, changes speed, adds captions and a voice. It cannot create footage. When a clip is sped up, the frame says so.
Needs ffmpeg and the macOS `say` command.
"""
import json, os, subprocess, sys, tempfile, shlex

def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        sys.stderr.write(" ".join(shlex.quote(c) for c in cmd) + "\n" + r.stderr[-1500:] + "\n")
        raise SystemExit(1)
    return r.stdout

def duration(path):
    return float(run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path]).strip())

def esc(text):  # for ffmpeg drawtext
    return text.replace("\\", "\\\\").replace(":", "\\:").replace("'", "’").replace("%", "\\%").replace(",", "\\,")

def wrap(text, width):
    words, lines, cur = text.split(), [], ""
    for w in words:
        if len(cur) + len(w) + 1 > width: lines.append(cur); cur = w
        else: cur = (cur + " " + w).strip()
    if cur: lines.append(cur)
    return lines

FONT = "/System/Library/Fonts/Helvetica.ttc"
MONO = "/System/Library/Fonts/Menlo.ttc"
PAPER, INK, ACCENT = "0xF4EEE1", "0x1C1B19", "0x1F3A93"
W, H, FPS = 1920, 1080, 30

def main():
    plan = json.load(open(sys.argv[1])); out = sys.argv[2]
    tmp = tempfile.mkdtemp(prefix="pc-video-")
    parts = []
    for i, seg in enumerate(plan["segments"]):
        aiff, wav = f"{tmp}/{i}.aiff", f"{tmp}/{i}.wav"
        run(["say", "-v", plan.get("voice", "Samantha"), "-r", str(plan.get("rate", 175)), "-o", aiff, seg["say"]])
        run(["ffmpeg", "-y", "-i", aiff, "-ar", "48000", "-ac", "2", wav])
        speech = duration(wav)
        length = max(speech + seg.get("pad", 0.9), seg.get("min", 0))
        part = f"{tmp}/{i}.mp4"
        filters = []
        if seg.get("clip"):
            src = seg["clip"]; start = float(seg.get("start", 0)); avail = duration(src) - start
            use = float(seg.get("use", avail))            # seconds of source footage to show
            speed = max(1.0, use / length)                 # never slow footage down; pad with a held last frame instead
            filters.append(f"[0:v]trim=start={start}:duration={use},setpts=(PTS-STARTPTS)/{speed:.4f},fps={FPS},scale={W}:{H}:force_original_aspect_ratio=decrease,pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:color={PAPER},tpad=stop_mode=clone:stop_duration={length:.2f}[v0]")
            last = "[v0]"
            if speed > 1.25:
                filters.append(f"{last}drawtext=fontfile={MONO}:text='{esc(f'sped up {speed:.1f}x')}':fontsize=26:fontcolor=white:box=1:boxcolor={INK}@0.75:boxborderw=12:x=w-tw-40:y=40[v1]"); last = "[v1]"
            inputs = ["-i", src]
        else:
            inputs = ["-f", "lavfi", "-i", f"color=c={PAPER}:s={W}x{H}:r={FPS}:d={length:.2f}"]
            lines = wrap(seg.get("card", ""), 30)
            last = "[0:v]"
            for n, line in enumerate(lines):
                y = H / 2 - len(lines) * 55 + n * 110
                filters.append(f"{last}drawtext=fontfile={FONT}:text='{esc(line)}':fontsize=92:fontcolor={INK}:x=(w-tw)/2:y={y:.0f}[c{n}]"); last = f"[c{n}]"
            if seg.get("sub"):
                filters.append(f"{last}drawtext=fontfile={MONO}:text='{esc(seg['sub'])}':fontsize=34:fontcolor={ACCENT}:x=(w-tw)/2:y=h-170[cs]"); last = "[cs]"
        cap = seg.get("caption")
        if cap:
            for n, line in enumerate(wrap(cap, 78)[:2]):
                tag = f"[cap{n}]"
                filters.append(f"{last}drawtext=fontfile={FONT}:text='{esc(line)}':fontsize=38:fontcolor=white:box=1:boxcolor={INK}@0.82:boxborderw=18:x=(w-tw)/2:y=h-{150 - n * 62}{tag}"); last = tag
        filters.append(f"{last}format=yuv420p[v]")
        run(["ffmpeg", "-y", *inputs, "-i", wav, "-filter_complex", ";".join(filters), "-map", "[v]", "-map", "1:a", "-t", f"{length:.2f}",
             "-af", f"apad=whole_dur={length:.2f}", "-r", str(FPS), "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-c:a", "aac", "-b:a", "160k", "-ar", "48000", part])
        parts.append(part)
        print(f"segment {i}: {length:.1f}s  speech {speech:.1f}s  {'clip ' + os.path.basename(seg['clip']) if seg.get('clip') else 'card'}")
    lst = f"{tmp}/list.txt"
    open(lst, "w").write("".join(f"file '{p}'\n" for p in parts))
    run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", "-movflags", "+faststart", out])
    print(f"wrote {out}: {duration(out):.1f}s")

main()
