#!/usr/bin/env python3
"""Fits the recorded footage to Darren's own narration (one continuous recording; the voice is not cut or re-timed).
Run from the repository root:  python3 qa/recordings/voice-cut/build.py"""
import glob, json, re, subprocess, sys
OUT='qa/recordings/voice-cut'
VOICE='/Users/darrendeepak/Desktop/PettyCash-submission/voice.m4a'
HOUSE=sorted(glob.glob('qa/recordings/*-house'))[-1]+'/house.webm'
TRAP=sorted(glob.glob('qa/recordings/*-trap'))[-1]+'/trap.webm'
TOUR='qa/recordings/2026-11-20T10-49-11-449Z-tour/tour.webm'
LIMIT='qa/recordings/2026-11-20T10-08-54-198Z-limit/limit.webm'
WALLET=glob.glob('qa/journey-wallet-2026-11-20T10-44-54-663Z/page@*.webm')[0]

def run(cmd):
    r=subprocess.run(cmd,capture_output=True,text=True)
    if r.returncode!=0: sys.stderr.write(' '.join(cmd)[:600]+'\n'+r.stderr[-1500:]+'\n'); raise SystemExit(1)
    return r
def dur(p): return float(run(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',p]).stdout.strip())
NORM='fps=30,scale=1920:1080,setsar=1,format=yuv420p'
def composite(name, inputs, parts, shift=0):
    import os
    if os.environ.get('VOICE_ONLY') and os.path.exists(f"{OUT}/{name}.mp4"): return f"{OUT}/{name}.mp4"
    """parts: ('clip', input index, start, end, speed) or ('hold', input index, time, seconds)."""
    f=[]; labels=[]
    for n,p in enumerate(parts):
        # shift: move the page up so that what matters is not hidden behind the caption (the top strip is cropped away)
        N=NORM if not shift else f"fps=30,scale=1920:1080,crop=1920:{1080-shift}:0:{shift},pad=1920:1080:0:0:color=0xF4EEE1,setsar=1,format=yuv420p"
        if p[0]=='clip': _,i,a,b,sp=p; f.append(f"[{i}:v]trim=start={a}:end={b},setpts=(PTS-STARTPTS)/{sp},{N}[p{n}]")
        else: _,i,t,d=p; f.append(f"[{i}:v]trim=start={t}:end={t+0.05},setpts=PTS-STARTPTS,{N},tpad=stop_mode=clone:stop_duration={d}[p{n}]")
        labels.append(f"[p{n}]")
    f.append(''.join(labels)+f"concat=n={len(parts)}:v=1:a=0[v]")
    out=f"{OUT}/{name}.mp4"; cmd=['ffmpeg','-y','-loglevel','error']
    for i in inputs: cmd+=['-i',i]
    run(cmd+['-filter_complex',';'.join(f),'-map','[v]','-r','30','-c:v','libx264','-crf','14','-preset','fast','-pix_fmt','yuv420p',out])
    print(f"{name}: {dur(out):.2f}s"); return out

# ── the narration: where each line starts and ends in the recording (seconds), found from its pauses
A0, AEND, TAIL = 1.15, 152.45, 2.20
cuts=[A0, 9.085, 39.64, 55.67, 77.32, 102.235, 106.355, 115.885, 133.345, 139.035, AEND+TAIL]
L=[round(cuts[i+1]-cuts[i],3) for i in range(10)]

# ── the pictures for each line, timed to what is being said
l2=composite('l2-errand',[HOUSE],[('hold',0,3.2,2.3),('clip',0,3.0,9.7,1.0),('clip',0,9.7,43.3,1.559)])
l3=composite('l3-sellers',[TOUR],[('clip',0,14.6,21.6,1.0),('hold',0,21.6,2.6),('clip',0,21.6,28.0,1.0)])
l4=composite('l4-limit',[TOUR,LIMIT],[('clip',0,25.0,29.0,1.0),('hold',0,29.0,2.4),('clip',1,3.0,10.0,1.0),('clip',1,14.9,22.8,1.0)])
l5=composite('l5-trap',[TRAP],[('clip',0,5.4,9.0,1.0),('hold',0,8.9,7.1),('clip',0,12.6,14.1,1.0),('clip',0,14.1,27.84,1.963),('clip',0,27.84,33.6,1.0)])
l7=composite('l7-setaside',[WALLET],[('hold',0,2.96,2.0),('clip',0,2.96,4.5,1.0),('hold',0,4.5,1.5),('clip',0,7.32,8.3,1.0)])
l8=composite('l8-approve',[WALLET],[('clip',0,8.5,13.2,1.0),('hold',0,16.6,5.55),('clip',0,16.6,17.45,1.0),('clip',0,17.45,29.55,2.1)], shift=120)
l9=composite('l9-revoke',[WALLET],[('clip',0,141.0,144.6,1.0)])

segs=[
 {"card":"Give your AI petty cash, not your wallet.","sub":"Petty Cash  ·  real USDC on Solana mainnet"},
 {"clip":l2,"caption":"PUBLIC DEMO · no wallet connected · real USDC on Solana mainnet","badge_text":"errand sped up 1.6x"},
 {"clip":l3,"caption":"PUBLIC DEMO · independent sellers, paid per request over x402"},
 {"clip":l4,"caption":"PUBLIC DEMO · Solana's Subscriptions and Allowances program refuses the over-limit pull"},
 {"clip":l5,"caption":"PUBLIC DEMO · a page with hostile instructions. The agent reports them and does not obey.","badge_text":"errand sped up 2x"},
 {"card":"Now with my own wallet","sub":"Connect a wallet to set your own budget"},
 {"clip":l7,"caption":"MY OWN WALLET · a real mainnet allowance: eight cents for 24 hours · recorded with an automated test wallet"},
 {"clip":l8,"caption":"MY OWN WALLET · anything above one cent waits for my approval","badge_text":"wait sped up 2.1x"},
 {"clip":l9,"caption":"MY OWN WALLET · revoke closes the allowance on Solana mainnet"},
 {"card":"Petty Cash","sub":"pettycash-pink.vercel.app  ·  try it with no wallet","caption":"Try it with no wallet. Connect your own to set your own budget."},
]
for i,s in enumerate(segs):
    s["line"]=i+1; s["length"]=L[i]
    if "clip" in s: s["start"]=0; s["use"]=round(dur(s["clip"]),2)
plan={"silent":True,"voice":VOICE,"voice_cuts":cuts,"segments":segs}
json.dump(plan,open(f"{OUT}/plan-voice.json","w"),indent=1)
print("line lengths:",L,"total",round(sum(L),2))

# ── the voice: one continuous track, trimmed at both ends, rumble removed, one gentle gain for the whole thing
pre=f"atrim=start={A0}:end={AEND},asetpts=PTS-STARTPTS,highpass=f=70"
e=run(['ffmpeg','-hide_banner','-i',VOICE,'-af',pre+',loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json','-f','null','-']).stderr
loud=float(re.search(r'"input_i"\s*:\s*"(-?[0-9.]+)"',e).group(1)); peak=float(re.search(r'"input_tp"\s*:\s*"(-?[0-9.]+)"',e).group(1))
gain=min(-18.0-loud, 20.0)  # quiet recording: bring it to about -18 LUFS; the limiter only catches the few loudest peaks
n=AEND-A0
run(['ffmpeg','-y','-loglevel','error','-i',VOICE,'-af',f"{pre},volume={gain:.2f}dB,alimiter=limit=0.84:attack=5:release=80:level=false,afade=t=in:d=0.03,afade=t=out:st={n-0.25:.3f}:d=0.25,apad=pad_dur={TAIL}",'-ar','48000','-ac','2',f"{OUT}/voice-clean.wav"])
print(f"voice: measured {loud:.1f} LUFS, true peak {peak:.1f} dB, gain applied {gain:+.1f} dB, length {dur(OUT+'/voice-clean.wav'):.2f}s")
