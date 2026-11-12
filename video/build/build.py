import json,subprocess
d=json.load(open('marks.json')); t0=d['t0']; M={m['id']:m['at'] for m in d['marks']}
start,end=M['start'],M['end']
fr=[(f['name'],f['ts']-t0) for f in d['frames']]
keep=[x for x in fr if x[1]<=start]; first=keep[-1] if keep else fr[0]
seq=[(first[0],start)]+[x for x in fr if start<x[1]<end]
lines=[]
for i,(n,t) in enumerate(seq):
    nt=seq[i+1][1] if i+1<len(seq) else end
    lines.append(f"file 'frames/{n}'\nduration {max(nt-t,0.001):.4f}")
lines.append(f"file 'frames/{seq[-1][0]}'")
open('frames.txt','w').write("\n".join(lines)+"\n")
N=json.load(open('narration.json'))
inputs=[];filt=[];labels=[]
for i,s in enumerate(N):
    inputs+=['-i',f"{s['id']}.aiff"]
    ms=int((M[s['id']]-start)*1000)
    filt.append(f"[{i+1}:a]aresample=48000,adelay={ms}|{ms}[a{i}]"); labels.append(f"[a{i}]")
filt.append("".join(labels)+f"amix=inputs={len(N)}:normalize=0,apad[aout]")
dur=end-start
subprocess.run(['ffmpeg','-y','-loglevel','error','-f','concat','-safe','0','-i','frames.txt']+inputs+['-filter_complex',";".join(filt)+";[0:v]scale=1920:1080:flags=lanczos,fps=30,format=yuv420p[v]",'-map','[v]','-map','[aout]','-t',f"{dur:.2f}",'-c:v','libx264','-preset','medium','-crf','18','-c:a','aac','-b:a','192k','-movflags','+faststart','promisepay-demo.mp4'],check=True)
def ts(x):
    h=int(x//3600);m=int(x%3600//60);s=x%60;ms=min(999,int(round((s-int(s))*1000)))
    return f"{h:02}:{m:02}:{int(s):02},{ms:03d}"
out=[f"{i+1}\n{ts(M[s['id']]-start)} --> {ts(M[s['id']]-start+s['dur'])}\n{s['text']}\n" for i,s in enumerate(N)]
open('promisepay-demo.srt','w').write("\n".join(out))
print("duration",round(dur,2), "replay at", round(M['replay']-start,1))
