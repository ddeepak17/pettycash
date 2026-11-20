#!/usr/bin/env python3
"""Assembles a demo video from REAL screen recordings of the live product, with captions and a synthetic voice.

  python3 scripts/video/assemble.py <plan.json> <out.mp4>          (run from the repository root)

plan.json: { "voice": "Samantha", "rate": 168, "segments": [ { "clip": "path.webm" or absent, "card": "title text",
             "sub": "small line on a card", "start": seconds into the clip, "use": seconds of footage to show,
             "say": "narration", "caption": "on-screen caption", "pad": seconds of silence after the narration } ] }

Every clip is footage recorded by tests/e2e/record.ts or tests/e2e/journey.ts against the deployed app. This script
only trims, changes speed, and adds captions and a voice. It cannot create footage. Footage is never slowed down;
when it is sped up, the frame says so. Needs ffmpeg, the macOS `say` command, and Chrome (for rendering text).
"""
import json, os, subprocess, sys, tempfile, shlex

def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        sys.stderr.write(" ".join(shlex.quote(c) for c in cmd)[:1500] + "\n" + r.stderr[-1500:] + "\n")
        raise SystemExit(1)
    return r.stdout

def duration(path):
    return float(run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path]).strip())

PAPER, W, H, FPS = "0xF4EEE1", 1920, 1080, 30

def main():
    plan = json.load(open(sys.argv[1])); out = sys.argv[2]
    tmp = tempfile.mkdtemp(prefix="pc-video-")
    segs, renders = [], []
    for i, seg in enumerate(plan["segments"]):
        aiff, wav = f"{tmp}/{i}.aiff", f"{tmp}/{i}.wav"
        lead = 0.0
        if seg.get("audio"):
            # A person's own recording of this line. The footage is fitted to it; the voice is never stretched.
            run(["ffmpeg", "-y", "-i", seg["audio"], "-ar", "48000", "-ac", "2", wav])
            speech = duration(wav); lead = float(plan.get("lead", 0.3))
            length = max(lead + speech + seg.get("pad", plan.get("pad", 0.6)), seg.get("min", 0))
        elif plan.get("silent"):
            # No narration at all: each segment simply lasts as long as the plan says.
            length = float(seg["length"]); speech = 0.0
            run(["ffmpeg", "-y", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", f"{length:.2f}", wav])
        else:
            run(["say", "-v", plan.get("voice", "Samantha"), "-r", str(plan.get("rate", 168)), "-o", aiff, seg["say"]])
            run(["ffmpeg", "-y", "-i", aiff, "-ar", "48000", "-ac", "2", wav])
            speech = duration(wav)
            length = max(speech + seg.get("pad", 0.9), seg.get("min", 0))
        info = {"i": i, "seg": seg, "wav": wav, "speech": speech, "length": length, "speed": 1.0, "lead": lead}
        if seg.get("clip"):
            start = float(seg.get("start", 0)); use = float(seg.get("use", duration(seg["clip"]) - start))
            info.update(start=start, use=use, speed=max(1.0, use / length))
            if info["speed"] > 1.25:
                info["badge"] = f"{tmp}/{i}-badge.png"; renders.append({"file": info["badge"], "kind": "badge", "text": f"sped up {info['speed']:.1f}x"})
        else:
            info["card"] = f"{tmp}/{i}-card.png"; renders.append({"file": info["card"], "kind": "card", "text": seg.get("card", ""), "sub": seg.get("sub")})
        if seg.get("caption"):
            info["cap"] = f"{tmp}/{i}-cap.png"; renders.append({"file": info["cap"], "kind": "caption", "text": seg["caption"]})
        segs.append(info)
    json.dump(renders, open(f"{tmp}/render.json", "w"))
    print(run(["pnpm", "tsx", "scripts/video/render-text.ts", f"{tmp}/render.json"]).strip().splitlines()[-1])

    parts = []
    for s in segs:
        i, length = s["i"], s["length"]
        inputs, filters, n = [], [], 0
        if "card" in s:
            inputs += ["-loop", "1", "-t", f"{length:.2f}", "-i", s["card"]]
            filters.append(f"[0:v]fps={FPS},scale={W}:{H}[b0]")
        else:
            inputs += ["-i", s["seg"]["clip"]]
            filters.append(f"[0:v]trim=start={s['start']}:duration={s['use']},setpts=(PTS-STARTPTS)/{s['speed']:.4f},fps={FPS},scale={W}:{H}:force_original_aspect_ratio=decrease,pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:color={PAPER},tpad=stop_mode=clone:stop_duration={length:.2f}[b0]")
        last, n = "[b0]", 1
        for key in ("cap", "badge"):
            if key in s:
                inputs += ["-loop", "1", "-t", f"{length:.2f}", "-i", s[key]]
                filters.append(f"{last}[{n}:v]overlay=0:0:shortest=0[o{n}]"); last = f"[o{n}]"; n += 1
        filters.append(f"{last}format=yuv420p[v]")
        part = f"{tmp}/{i}.mp4"
        run(["ffmpeg", "-y", *inputs, "-i", s["wav"], "-filter_complex", ";".join(filters), "-map", "[v]", "-map", f"{n}:a", "-t", f"{length:.2f}",
             "-af", (f"adelay={int(s['lead'] * 1000)}|{int(s['lead'] * 1000)}," if s["lead"] else "") + f"apad=whole_dur={length:.2f}", "-r", str(FPS), "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-c:a", "aac", "-b:a", "160k", "-ar", "48000", part])
        parts.append(part)
        what = "card" if "card" in s else f"clip {os.path.basename(s['seg']['clip'])[:28]} speed {s['speed']:.2f}x"
        print(f"segment {i}: {length:5.1f}s  speech {s['speech']:5.1f}s  {what}")
    t, timeline = 0.0, []
    for s in segs:
        timeline.append({"line": s["i"] + 1, "start": round(t, 2), "end": round(t + s["length"], 2), "speech": round(s["speech"], 2), "speed": round(s["speed"], 2),
                         "what": s["seg"].get("card") or os.path.basename(s["seg"].get("clip", ""))})
        t += s["length"]
    json.dump(timeline, open(out + ".timeline.json", "w"), indent=1)
    lst = f"{tmp}/list.txt"
    open(lst, "w").write("".join(f"file '{p}'\n" for p in parts))
    run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", "-movflags", "+faststart", out])
    print(f"wrote {out}: {duration(out):.1f}s")

main()
