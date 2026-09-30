#!/usr/bin/env python3
"""One task per neutral character. Credentials and provider replies stay ignored."""
import json,pathlib,urllib.request,sys,hashlib
ROOT=pathlib.Path('.processing-data/yuezhi-tripo');ROOT.mkdir(parents=True,exist_ok=True)
API='https://openapi.tripo3d.ai/v3'; KEY=(ROOT/'key').read_text().strip()
OPENER=urllib.request.build_opener(urllib.request.ProxyHandler({}))
def req(method,path,body=None):
 r=urllib.request.Request(API+path,data=None if body is None else json.dumps(body).encode(),method=method,headers={'Authorization':'Bearer '+KEY,'Content-Type':'application/json'})
 with OPENER.open(r,timeout=45) as f:d=json.load(f)
 if d.get('code')!=0:raise RuntimeError('Provider rejected '+str(d.get('code'))+' '+str(d.get('message')))
 return d
prompts={
'envoy':'A realistic full-body adult male ancient East Asian traveller, standing in a relaxed neutral pose, both arms naturally lowered and slightly separated from torso, both feet visible. Practical earth-brown layered linen cross-collar robe to mid calf, cloth belt, plain trousers and worn leather shoes, simple tied dark hair, restrained natural face. Real fabric folds and rough woven texture, anatomically proportioned human, museum diorama character. No weapon, crown, jewelry, bag, pedestal, background or text. An illustrative historical visitor, not a specific portrait.',
'yuezhi':'A realistic full-body adult male ancient Central Asian pastoral community member, standing relaxed, both arms naturally lowered and slightly separated from torso, feet visible. Practical muted sage green wool tunic to knees with plain cloth belt, brown loose trousers, simple worn leather boots, dark hair and short modest beard. Natural woven fabric folds and understated face, anatomically proportioned human, museum diorama character. No weapon, crown, armor, elaborate jewelry, pedestal, background or text. Neutral illustrative community representative, not a king or specific person.'}
mode=sys.argv[1]
if mode=='balance':
 d=req('GET','/account/balance');(ROOT/'balance-before.json').write_text(json.dumps(d));print(d)
elif mode=='create':
 for label,prompt in prompts.items():
  p=ROOT/(label+'-create.json')
  if p.exists():print(label,'already exists');continue
  if (ROOT/(label+'-submission-started')).exists():raise RuntimeError(label+' unknown submission outcome; do not resubmit')
  body={'prompt':prompt,'model':'v3.1-20260211','texture':True,'pbr':True,'texture_quality':'standard','geometry_quality':'standard','face_limit':40000}
  (ROOT/(label+'-request.json')).write_text(json.dumps(body,indent=2)); (ROOT/(label+'-submission-started')).write_text('Do not resubmit unknown outcome')
  d=req('POST','/generation/text-to-model',body);p.write_text(json.dumps(d)); print(label,d['data']['task_id'])
elif mode=='poll':
 for label in prompts:
  p=ROOT/(label+'-create.json')
  if not p.exists():continue
  task=json.loads(p.read_text())['data']['task_id'];d=req('GET','/tasks/'+task);(ROOT/(label+'-task.json')).write_text(json.dumps(d));v=d['data']; print(label,v.get('status'),v.get('progress'),v.get('credits_consumed'))
  if v.get('status')=='success' and not (ROOT/(label+'-raw.glb')).exists():
   o=v['output'];url=o.get('model_url') or o.get('pbr_model') or o.get('model');
   if not url: print('output keys',list(o));continue
   with OPENER.open(url,timeout=90) as f:raw=f.read()
   (ROOT/(label+'-raw.glb')).write_bytes(raw);print(label,'downloaded',len(raw),hashlib.sha256(raw).hexdigest())
