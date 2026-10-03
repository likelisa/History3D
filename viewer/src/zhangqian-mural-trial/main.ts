import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { ModelView, disposeModel, type ViewMode } from '../tripo-lab/model-view.ts'
import './style.css'

type Record = {status:string;taskId:string;sha256?:string;bytes?:number;creditsConsumed?:number;path?:string;stats?:{triangles:number;materials:number;embeddedImages:number}}
const element=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T
const status=element('status'),host=element('viewport')
let view:ModelView|undefined
function fact(label:string,value:string){const box=document.createElement('div'),title=document.createElement('dt'),content=document.createElement('dd');title.textContent=label;content.textContent=value;box.append(title,content);element('facts').append(box)}
async function start(){
  let parsed:THREE.Group|undefined
  try{
    const response=await fetch('/mural-assets/zhangqian-mural-trial/provenance.json',{cache:'no-store'})
    if(!response.ok)throw new Error('尚未读取到任务记录')
    const record=await response.json() as Record
    fact('任务',record.taskId);fact('Credits',record.creditsConsumed==null?'尚未返回':String(record.creditsConsumed));fact('生成方式','原画裁切 · 图生3D')
    if(record.status!=='downloaded'||!record.path||!record.sha256||!record.bytes){status.textContent='Tripo任务：'+record.status+'。结果下载后刷新本页。';return}
    const asset=new URL(record.path,location.origin)
    if(asset.origin!==location.origin||asset.pathname!=='/mural-assets/zhangqian-mural-trial/zhangqian-raw.glb')throw new Error('模型路径与试验不符')
    status.textContent='核验模型SHA-256和文件大小…'
    const file=await fetch(asset,{cache:'no-store'});if(!file.ok)throw new Error('模型下载记录存在，但本地文件未能读取')
    const buffer=await file.arrayBuffer()
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buffer)),v=>v.toString(16).padStart(2,'0')).join('')
    if(hash!==record.sha256||buffer.byteLength!==record.bytes)throw new Error('模型SHA-256或文件大小不符')
    const header=new DataView(buffer)
    if(buffer.byteLength<20||header.getUint32(0,true)!==0x46546c67||header.getUint32(4,true)!==2||header.getUint32(8,true)!==buffer.byteLength||header.getUint32(16,true)!==0x4e4f534a)throw new Error('文件不是有效GLB')
    const doc=JSON.parse(new TextDecoder().decode(new Uint8Array(buffer,20,header.getUint32(12,true)))) as {images?:{uri?:string}[];buffers?:{uri?:string}[]}
    if([...doc.images??[],...doc.buffers??[]].some(r=>r.uri&&!r.uri.startsWith('data:')))throw new Error('GLB包含未校验的外部资源')
    const gltf=await new GLTFLoader().parseAsync(buffer,asset.href.slice(0,asset.href.lastIndexOf('/')+1))
    parsed=gltf.scene
    const bounds=new THREE.Box3().setFromObject(parsed),size=bounds.getSize(new THREE.Vector3())
    if(bounds.isEmpty()||!size.toArray().every(Number.isFinite)||Math.max(...size.toArray())<=0)throw new Error('模型几何范围无效')
    view=new ModelView(host,parsed,bounds,3.3/Math.max(...size.toArray()),()=>{})
    host.dataset.loaded='zhangqian-mural-trial';host.dataset.sha256=record.sha256
    status.textContent='原始GLB已核验。拖动旋转、滚轮缩放，查看背面与轮廓。'
    fact('三角面数',(record.stats?.triangles??0).toLocaleString('zh-CN'));fact('文件',(record.bytes/1024/1024).toFixed(2)+' MB');fact('SHA-256',record.sha256)
    element('download').hidden=false
  }catch(error){if(parsed&&!view)disposeModel(parsed);status.textContent=error instanceof Error?error.message:String(error);status.classList.add('error')}
}
element('front').addEventListener('click',()=>view?.setPose({position:new THREE.Vector3(6,2,0),target:new THREE.Vector3(0,1.5,0)}))
element('back').addEventListener('click',()=>view?.setPose({position:new THREE.Vector3(-6,2,0),target:new THREE.Vector3(0,1.5,0)}))
element('reset').addEventListener('click',()=>view?.reset())
element<HTMLSelectElement>('mode').addEventListener('change',event=>view?.setMode((event.target as HTMLSelectElement).value as ViewMode))
window.addEventListener('pagehide',()=>view?.dispose())
void start()
