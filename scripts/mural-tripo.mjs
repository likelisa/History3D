import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {createHash} from 'node:crypto'
const key=process.env.TRIPO_API_KEY?.trim()
if(!key)throw new Error('TRIPO_API_KEY is required; normal viewer/build never calls this authoring tool')
const root='.processing-data/mural-tripo'
const prompts={
 monk:'Single full-body standing anonymous Buddhist monk inspired by an early Tang Dunhuang wall painting. Shaved head, serene face, long simple overlapping draped robe, muted ochre and earth brown mineral pigments with dark indigo inner cloth, plain feet visible. Hands together gently at waist, dignified neutral standing pose. Sculptural stylized human with physically thick flowing fabric folds, hand-painted matte fresco texture, weathered mineral pigment, elegant slender proportions. Museum illustrative figure, not a verified portrait or Han dynasty historical reconstruction. No pedestal, no background, no accessories, no modern clothing, no cartoon eyes, no golden statue. One person only.',
 tower:'One freestanding ancient Buddhist tower inspired by the small tower silhouette in early Tang Dunhuang Mogao cave 323 mural. Square stepped pale stone base, tall dark indigo square body, a narrow pale arched niche outlined by ivory linework on the front, three stepped projecting cornices tapering upward, a small slender finial. Compact slender proportions, no large Chinese pagoda roof wings, no gate, no walls, no people, no entire city. Sculptural architectural model with tangible layered stone and plaster detail, hand-painted muted indigo and parchment mineral pigments, worn matte fresco surfaces, no glossy metallic parts, no modern elements. Interpretive 3D adaptation of a mural tower, single isolated object.'
}
const sha=b=>createHash('sha256').update(b).digest('hex')
async function load(p){try{return JSON.parse(await readFile(p,'utf8'))}catch(e){if(e.code==='ENOENT')return null;throw e}}
async function save(p,d){await writeFile(p,JSON.stringify(d,null,2)+'\n')}
async function call(method,p,body){const r=await fetch('https://openapi.tripo3d.ai/v3'+p,{method,headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(60000)});const d=await r.json();if(!r.ok||d.code!==0)throw new Error('TRIPO_HTTP_'+r.status+'_CODE_'+d.code);return d.data}
const [command,id]=process.argv.slice(2)
if(!prompts[id])throw new Error('Unknown bounded asset')
await mkdir(root,{recursive:true})
const file=`${root}/${id}.json`
let record=await load(file)
try {
 if(command==='create'){
  if(record){console.log(JSON.stringify(record));process.exit(0)}
  if(await load(`${root}/${id}-intent.json`))throw new Error('UNKNOWN_SUBMISSION_DO_NOT_REPEAT')
  const request={prompt:prompts[id],model:'v3.1-20260211',texture:true,pbr:true,face_limit:40000,geometry_quality:'standard',texture_quality:'standard'}
  await save(`${root}/${id}-request.json`,request)
  await writeFile(`${root}/${id}-intent.json`,JSON.stringify({sha256:sha(JSON.stringify(request)),at:new Date().toISOString()}),{flag:'wx'})
  const data=await call('POST','/generation/text-to-model',request)
  if(!data.task_id)throw new Error('MISSING_TASK_ID')
  record={id,taskId:data.task_id,requestHash:sha(JSON.stringify(request)),status:'submitted',source:'Text interpretation of supplied Mogao cave 323 mural',submittedAt:new Date().toISOString()};await save(file,record)
 }else if(command==='poll'){
  if(!record?.taskId)throw new Error('MISSING_VERIFIED_TASK')
  const data=await call('GET','/tasks/'+encodeURIComponent(record.taskId))
  record={...record,status:data.status,progress:data.progress,creditsConsumed:data.credits_consumed,checkedAt:new Date().toISOString()}
  if(data.status==='success'&&!record.sha256){const url=data.output?.model_url||data.output?.pbr_model||data.output?.model;if(!url?.startsWith('https://'))throw new Error('NO_OUTPUT_MODEL');const r=await fetch(url,{signal:AbortSignal.timeout(90000)});if(!r.ok)throw new Error('DOWNLOAD_HTTP_'+r.status);const b=Buffer.from(await r.arrayBuffer());if(b.toString('ascii',0,4)!=='glTF'||b.readUInt32LE(8)!==b.length)throw new Error('INVALID_GLB');const output=`viewer/public/mural-assets/${id}.glb`;await writeFile(output,b);record={...record,sha256:sha(b),bytes:b.length,path:output}}
  await save(file,record)
  if(record.sha256)await save(`viewer/public/mural-assets/${id}-provenance.json`,record)
 }else throw new Error('Expected create or poll')
 console.log(JSON.stringify(record))
}catch(e){console.error(String(e.message).split(key).join('[redacted]').replace(/https?:\/\/\S+/g,'[url]'));process.exitCode=1}
