import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { ModelView, disposeModel, type ViewMode } from './model-view.ts'
import './style.css'

type Asset='staff'|'gate'
type Case={id:string;asset:Asset;title:string;variant:string;label:string;request:Record<string,unknown>&{prompt:string;negative_prompt?:string};criteria:string[]}
type Experiment={experimentId:string;purpose:string;controls:string;interpretation:string;currentReference:Record<Asset,string>;sources:string[];cases:Case[]}
type Result={id:string;status:string;taskId:string|null;creditsConsumed:number|null;path:string|null;sha256:string|null;bytes:number|null;stats:{triangles?:number;meshes?:number;materials?:number;images?:number;normalMappedMaterials?:number}|null;error?:string}
type Results={experimentId:string;updatedAt:string;cases:Result[]}
type Loaded={record:Result;model:THREE.Group;bounds:THREE.Box3;size:THREE.Vector3}
type Card={host:HTMLElement;status:HTMLElement;empty:HTMLElement;stats:HTMLElement;identity:HTMLElement}
const query=<T extends HTMLElement=HTMLElement>(id:string)=>document.querySelector<T>('#'+id)!
const comparison=query('comparison'),status=query('experiment-status'),refresh=query<HTMLButtonElement>('refresh'),mode=query<HTMLSelectElement>('view-mode'),link=query<HTMLInputElement>('link-views')
let experiment:Experiment|undefined,selected:Asset='staff',requestId=0,controller:AbortController|undefined
const views:(ModelView|undefined)[]=[]
const statuses:Record<string,string>={not_submitted:'尚未提交生成',submitted:'已提交 Tripo，等待结果',queued:'Tripo 排队中',running:'Tripo 生成中',processing:'Tripo 处理中',success:'Tripo 已完成，等待文件落地',downloaded:'真实模型已下载',failed:'生成失败',cancelled:'任务已取消'}
const text=(tag:string,value:string,className?:string)=>{const node=document.createElement(tag);node.textContent=value;if(className)node.className=className;return node}
const number=(value:number|undefined|null)=>value==null?'未返回':value.toLocaleString('zh-CN')
const bytes=(value:number|undefined|null)=>value==null?'未返回':`${(value/1024/1024).toFixed(2)} MB`
function clearViews(){views.forEach(view=>view?.dispose());views.length=0}
async function json<T>(path:string,signal:AbortSignal):Promise<T>{const response=await fetch(path,{cache:'no-store',signal});if(!response.ok)throw new Error(`读取失败：${path}（${response.status}）`);return response.json() as Promise<T>}
function makeCard(item:Case,record:Result|undefined):Card{
 const article=text('article','','variant'),heading=text('div','','variant-header'),title=text('div','')
 title.append(text('h2',item.label),text('p',item.title,'label'));heading.append(text('span',item.variant,'letter'),title)
 const host=text('div','','viewport'),empty=text('div','','empty-model'),message=text('span',record?statuses[record.status]??`任务状态：${record.status}`:'没有结果记录')
 empty.append(message,text('small','只展示核验后的真实生成文件。完成后点击「刷新结果」。'));host.append(empty)
 const info=text('p',record?statuses[record.status]??record.status:'尚无结果记录','model-status')
 const stats=text('dl','','facts'),identity=text('div','','identity')
 const details=document.createElement('details');details.append(text('summary','查看完整提示词'),text('pre',item.request.prompt,'prompt'))
 if(item.request.negative_prompt)details.append(text('p','负面提示词：'+item.request.negative_prompt,'negative'))
 article.append(heading,host,info,stats,identity,details);comparison.append(article)
 return{host,status:info,empty,stats,identity}
}
function facts(card:Card,record:Result,loaded?:Loaded){
 card.stats.replaceChildren()
 const values=[['三角面数',number(record.stats?.triangles)],['文件大小',bytes(record.bytes)],['法线贴图材质数',number(record.stats?.normalMappedMaterials)],['材质 / 图像',`${number(record.stats?.materials)} / ${number(record.stats?.images)}`],['已消耗 Credits',number(record.creditsConsumed)],['原始 XYZ 尺寸',loaded?loaded.size.toArray().map(value=>value.toFixed(3)).join(' × '):'待核验模型']]
 for(const [label,value] of values){const cell=document.createElement('div');cell.append(text('dt',label!),text('dd',value!));card.stats.append(cell)}
 card.identity.replaceChildren(text('div','Tripo 任务：'+(record.taskId??'未提交')),text('div','状态：'+record.status))
 if(record.sha256){const row=text('div','SHA-256：');row.append(text('code',record.sha256));card.identity.append(row)}
 if(record.error)card.identity.append(text('div',record.error,'error'))
}
/** Provider files stay unchanged; SHA and byte count are checked before parsing. */
async function load(record:Result,signal:AbortSignal):Promise<Loaded>{
 if(!record.path||!record.sha256||!record.bytes)throw new Error('模型文件或校验记录不完整')
 const path=new URL(record.path,location.origin)
 if(path.origin!==location.origin||!path.pathname.startsWith('/tripo-prompt-lab/')||!path.pathname.endsWith('.glb'))throw new Error('模型路径不属于本实验')
 const response=await fetch(path,{cache:'no-store',signal});if(!response.ok)throw new Error(`模型读取失败（${response.status}）`)
 const buffer=await response.arrayBuffer()
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buffer)),value=>value.toString(16).padStart(2,'0')).join('')
 if(buffer.byteLength!==record.bytes||hash!==record.sha256)throw new Error('SHA-256 或文件大小不符，已停止显示此模型')
 const header=new DataView(buffer)
 if(buffer.byteLength<20||header.getUint32(0,true)!==0x46546c67)throw new Error('文件不是有效 GLB')
 const metadata=JSON.parse(new TextDecoder().decode(new Uint8Array(buffer,20,header.getUint32(12,true)))) as {buffers?:{uri?:string}[];images?:{uri?:string}[]}
 if([...metadata.buffers??[],...metadata.images??[]].some(item=>item.uri&&!item.uri.startsWith('data:')))throw new Error('GLB 包含未经校验的外部资源')
 const gltf=await new GLTFLoader().parseAsync(buffer,path.href.slice(0,path.href.lastIndexOf('/')+1))
 const bounds=new THREE.Box3().setFromObject(gltf.scene),size=bounds.getSize(new THREE.Vector3())
 if(bounds.isEmpty()||!size.toArray().every(Number.isFinite)||Math.max(size.x,size.y,size.z)<=0){disposeModel(gltf.scene);throw new Error('模型几何范围无效')}
 return{record,model:gltf.scene,bounds,size}
}
function describe(item:Case){
 query('criteria').replaceChildren(...item.criteria.map(criterion=>text('li',criterion)))
 query('controls').textContent=experiment!.controls
 query('references').textContent=`既有资产来源：${experiment!.currentReference.staff}；${experiment!.currentReference.gate}。它们没有作为本页 Tripo A/B 生成结果显示。`
 query('interpretation').textContent=experiment!.interpretation
 const {prompt:_,negative_prompt:__,...parameters}=item.request
 query('parameters').textContent='本组固定参数：\n'+JSON.stringify(parameters,null,2)
 const sources=query('sources');sources.replaceChildren()
 for(const source of experiment!.sources){const url=new URL(source);if(url.protocol!=='https:')continue;const anchor=text('a',url.hostname+' · '+url.pathname) as HTMLAnchorElement;anchor.href=url.href;anchor.target='_blank';anchor.rel='noopener noreferrer';sources.append(anchor)}
}
async function refreshPair(){
 const token=++requestId
 controller?.abort();controller=new AbortController();const signal=controller.signal
 clearViews();comparison.replaceChildren();refresh.disabled=true;status.classList.remove('error');status.textContent='读取最新任务记录…'
 query('scale-note').textContent='A / B 共用比例、灯光与初始视角。原始尺寸只用于相对比较，不作为真实米制测量。'
 try{
  if(!experiment)experiment=await json<Experiment>('/tripo-prompt-lab/experiment.json',signal)
  const results=await json<Results>('/tripo-prompt-lab/results.json',signal)
  if(token!==requestId)return
  if(results.experimentId!==experiment.experimentId)throw new Error('实验配置与结果记录不属于同一实验')
  const cases=experiment.cases.filter(item=>item.asset===selected).sort((a,b)=>a.variant.localeCompare(b.variant))
  if(cases.length!==2)throw new Error('本组必须具有 A / B 两份配置')
  describe(cases[0]!)
  const records=cases.map(item=>results.cases.find(record=>record.id===item.id))
  const cards=cases.map((item,index)=>makeCard(item,records[index]))
  status.textContent=`${experiment.purpose} · 更新于 ${new Date(results.updatedAt).toLocaleString('zh-CN',{timeZone:'Asia/Hong_Kong',hour12:false})}`
  const loaded=await Promise.all(records.map(async(record,index)=>{
   if(!record)return undefined
   const card=cards[index]!;facts(card,record)
   if(record.status!=='downloaded')return undefined
   card.status.textContent='读取 GLB 并核验 SHA-256 / 文件大小…'
   try{return await load(record,signal)}catch(error){if(token===requestId){card.status.textContent=error instanceof Error?error.message:String(error);card.status.classList.add('error');card.empty.replaceChildren(text('span','模型未能显示'),text('small','点击「刷新结果」重试。'))}return undefined}
  }))
  if(token!==requestId){loaded.forEach(item=>{if(item)disposeModel(item.model)});return}
  const pair=loaded.filter((item):item is Loaded=>item!==undefined)
  if(pair.length){
   // One normalization factor for BOTH outputs. Centering is independent,
   // but their relative width/height/thickness is preserved in source units.
   const maximum=Math.max(...pair.flatMap(item=>item.size.toArray())),scale=3.3/maximum
   query('scale-note').textContent=pair.length===2?`A / B 共用 ${scale.toFixed(3)}× 显示倍率、相同灯光和镜头；保留原始相对尺寸。原始单位未标定为米。`:'目前仅一份核验成功；配对完成后会重新计算共享显示倍率。'
   for(const [index,item] of loaded.entries())if(item){
    const card=cards[index]!
    try{
     views[index]=new ModelView(card.host,item.model,item.bounds,scale,pose=>{if(link.checked)views.forEach((view,other)=>{if(other!==index)view?.setPose(pose)})})
     views[index]!.setMode(mode.value as ViewMode);card.empty.hidden=true;card.status.textContent='Tripo 真实生成 · SHA-256 / 文件大小核验通过 · 拖动旋转、滚轮缩放';facts(card,item.record,item)
     card.host.dataset.loaded=item.record.id;card.host.dataset.sha256=item.record.sha256!
    }catch(error){disposeModel(item.model);card.status.textContent=error instanceof Error?error.message:'无法开启 WebGL';card.status.classList.add('error')}
   }
  }
 }catch(error){if(token===requestId&&!signal.aborted){status.textContent=(error instanceof Error?error.message:String(error))+'；点击「刷新结果」重试。';status.classList.add('error')}}
 finally{if(token===requestId)refresh.disabled=false}
}
document.querySelectorAll<HTMLButtonElement>('[data-asset]').forEach(button=>button.addEventListener('click',()=>{
 selected=button.dataset.asset as Asset
 document.querySelectorAll('[data-asset]').forEach(other=>other.setAttribute('aria-pressed',String(other===button)))
 void refreshPair()
}))
refresh.addEventListener('click',()=>void refreshPair())
mode.addEventListener('change',()=>views.forEach(view=>view?.setMode(mode.value as ViewMode)))
query('reset-views').addEventListener('click',()=>views.forEach(view=>view?.reset()))
window.addEventListener('pagehide',()=>{++requestId;controller?.abort();clearViews()})
window.addEventListener('pageshow',event=>{if(event.persisted)void refreshPair()})
void refreshPair()
