"""Render the bundled GM percussion bank. Requires system libfluidsynth, Python 3.
Usage: python scripts/render-fluid-kit.py path/to/FluidR3Mono_GM.sf3 output-directory
Download the exact source and verify its SHA-256 as recorded below first.
No source bank or synthesis executable is bundled or downloaded by the app.
"""
import ctypes as C, array, hashlib, json, math, pathlib, wave, sys
SOURCE_SHA256='cfcd66d89e8386823400eca64934b14fbea7bf48ba1f00d21189af1262794ec2'
if len(sys.argv) != 3: raise SystemExit(__doc__)
source=pathlib.Path(sys.argv[1])
if hashlib.sha256(source.read_bytes()).hexdigest()!=SOURCE_SHA256: raise SystemExit('Unexpected source SoundFont hash')
lib=C.CDLL('libfluidsynth.so.3'); P=C.c_void_p

def f(name,ret,args):
 a=getattr(lib,name);a.restype=ret;a.argtypes=args;return a
settings=f('new_fluid_settings',P,[])();f('fluid_settings_setnum',C.c_int,[P,C.c_char_p,C.c_double])(settings,b'synth.sample-rate',44100.0)
f('fluid_settings_setnum',C.c_int,[P,C.c_char_p,C.c_double])(settings,b'synth.gain',0.8)
for name in [b'synth.reverb.active',b'synth.chorus.active']:
 f('fluid_settings_setint',C.c_int,[P,C.c_char_p,C.c_int])(settings,name,0)
synth=f('new_fluid_synth',P,[P])(settings)
sf=f('fluid_synth_sfload',C.c_int,[P,C.c_char_p,C.c_int])(synth,str(source).encode(),1)
select=f('fluid_synth_program_select',C.c_int,[P,C.c_int,C.c_int,C.c_int,C.c_int]);on=f('fluid_synth_noteon',C.c_int,[P,C.c_int,C.c_int,C.c_int]);off=f('fluid_synth_all_sounds_off',C.c_int,[P,C.c_int]);write=f('fluid_synth_write_float',C.c_int,[P,C.c_int,P,C.c_int,C.c_int,P,C.c_int,C.c_int]);version=f('fluid_version_str',C.c_char_p,[])().decode()
# Distinct physical cymbals: GM crash 2 is LC; crash 1 RC; ride 1 RD.
notes={'BD':36,'LB':35,'SN':38,'HH':42,'OH':46,'LP':44,'HT':50,'LT':47,'FT':41,'LC':57,'RC':49,'RD':51,'RB':53}
kits={'standard':0,'electronic':24,'jazz':32}
raw={}; peak=0.0
N=44100*12; left=(C.c_float*N)();right=(C.c_float*N)()
for kit,program in kits.items():
 for lane,note in notes.items():
  off(synth,9);select(synth,9,sf,128,program);on(synth,9,note,100);write(synth,N,left,0,1,right,0,1)
  data=array.array('f',((left[i]+right[i])*.5 for i in range(N)))
  last=max((i for i,x in enumerate(data) if abs(x)>10**(-75/20)),default=4410)
  end=min(len(data),max(4410,last+2206));data=data[:end]
  p=max(abs(v) for v in data);peak=max(peak,p);raw[(kit,lane)]=(data,p,note)
  print(kit,lane,round(len(data)/44100,3),round(p,5),flush=True)
gain=min(4.0,0.92/peak)
root=pathlib.Path(sys.argv[2]);root.mkdir(exist_ok=True)
manifest={'name':'FluidR3Mono GM drums','version':'2.312','sourceCommit':'45924076871483cb96b859cc374c5fbdbf76ba53','sourceUrl':'https://raw.githubusercontent.com/musescore/MuseScore/45924076871483cb96b859cc374c5fbdbf76ba53/share/sound/FluidR3Mono_GM.sf3','sourceSha256':'cfcd66d89e8386823400eca64934b14fbea7bf48ba1f00d21189af1262794ec2','license':'MIT','licenseUrl':'https://github.com/musescore/MuseScore/blob/45924076871483cb96b859cc374c5fbdbf76ba53/share/sound/FluidR3Mono_License.md','renderer':f'FluidSynth {version}','sampleRate':44100,'channels':1,'bitDepth':16,'midiChannel':10,'bank':128,'velocity':100,'reverb':False,'chorus':False,'sharedGain':gain,'tailThresholdDb':-75,'samples':[]}
for (kit,lane),(data,p,note) in raw.items():
 path=root/kit/(lane+'.wav');path.parent.mkdir(exist_ok=True)
 pcm=array.array('h',(max(-32767,min(32767,round(v*gain*32767))) for v in data))
 with wave.open(str(path),'wb') as out:out.setparams((1,2,44100,len(pcm),'NONE','not compressed'));out.writeframes(pcm.tobytes())
 b=path.read_bytes();manifest['samples'].append({'kit':kit,'lane':lane,'programZeroBased':kits[kit],'midiNote':note,'velocity':100,'file':str(path.relative_to(root)),'duration':len(data)/44100,'peak':p*gain,'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()})
(root/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
print('TOTAL',sum(x['bytes'] for x in manifest['samples']),'gain',gain)
