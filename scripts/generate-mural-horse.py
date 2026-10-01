"""One new Tripo text task; unknown submissions must never be retried."""
import pathlib,json,urllib.request,sys,hashlib
root=pathlib.Path('.processing-data/mural-horse');root.mkdir(parents=True,exist_ok=True)
key=pathlib.Path('.processing-data/yuezhi-tripo/key').read_text().strip()
opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
def req(method,path,body=None):
 r=urllib.request.Request('https://openapi.tripo3d.ai/v3'+path,data=json.dumps(body).encode() if body else None,method=method,headers={'Authorization':'Bearer '+key,'Content-Type':'application/json'})
 with opener.open(r,timeout=50) as f: d=json.load(f)
 if d.get('code')!=0: raise RuntimeError('Tripo rejected: '+str(d.get('message')))
 return d
if sys.argv[1]=='create':
 if (root/'create.json').exists(): print('Existing task',json.loads((root/'create.json').read_text())['data']['task_id']);sys.exit()
 if (root/'submission-started').exists(): raise RuntimeError('Unknown outcome: do not resubmit')
 balance=req('GET','/account/balance');(root/'balance-before.json').write_text(json.dumps(balance))
 body={'prompt':'One single complete horse, no rider, standing with all four hooves on the ground, simple historic bridle and a modest cloth saddle blanket. Stylized sculptural interpretation of a horse in the Early Tang Dunhuang Mogao Cave 323 mural: warm rust red and ochre mineral pigments, dark indigo fine painted contour lines, matte weathered plaster-like hand painted texture, restrained elegant elongated silhouette. All sides complete, readable from every angle, gentle natural proportions. No person, pedestal, buildings, landscape, text, weapons, modern equipment or photorealistic glossy finish. Artistic mural-inspired study, not an archaeological reconstruction.','model':'v3.1-20260211','texture':True,'pbr':True,'texture_quality':'standard','geometry_quality':'standard','face_limit':30000}
 (root/'request.json').write_text(json.dumps(body,indent=2));(root/'submission-started').write_text('Single authorized task; do not retry unknown outcome')
 d=req('POST','/generation/text-to-model',body);(root/'create.json').write_text(json.dumps(d));print('Created',d['data']['task_id'])
else:
 task=json.loads((root/'create.json').read_text())['data']['task_id'];d=req('GET','/tasks/'+task);(root/'task.json').write_text(json.dumps(d));v=d['data'];print(v.get('status'),v.get('progress'),v.get('credits_consumed'))
 if v.get('status')=='success' and not (root/'horse-raw.glb').exists():
  out=v['output'];url=out.get('model_url') or out.get('pbr_model') or out.get('model')
  with opener.open(url,timeout=90) as f: raw=f.read()
  (root/'horse-raw.glb').write_bytes(raw);print('Downloaded',len(raw),hashlib.sha256(raw).hexdigest())
