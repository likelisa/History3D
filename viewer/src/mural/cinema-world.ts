import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { bindWalkRig, type WalkRig } from './walking.ts'
import type {SceneBeatId} from './scene-beats.ts'
import {createGuardVariant} from './guard-variants.ts'
type Shot = {position:THREE.Vector3;target:THREE.Vector3}
export type CinemaWorld = {group:THREE.Group; update:(progress:number)=>void; camera:(progress:number)=>Shot; present:(beat:SceneBeatId,progress:number)=>Shot; anchors:(progress:number)=>Record<string,THREE.Vector3>; motion:()=>ReturnType<WalkRig['state']>[]; assetCount:number}

// The preserved monk mesh's textured face points along local +X. Turn the
// whole figure toward the incoming party, with the two hosts looking inward.
export function greetingYaw(host:THREE.Vector3,guest:THREE.Vector3){return Math.atan2(guest.x-host.x,guest.z-host.z)-Math.PI/2}

// A composed interpretation of the mural's mountain passage and city threshold.
export async function createCinemaWorld():Promise<CinemaWorld>{
 const group=new THREE.Group();group.visible=false
 const landscape=new THREE.Group(),meeting=new THREE.Group(),market=new THREE.Group(),camp=new THREE.Group()
 group.add(landscape,meeting,market,camp)
 const pigments={earth:'#b5a07a',road:'#dbc8a0',green:'#768d80',blue:'#536f6e',wall:'#465156',line:'#d8cba7'}
 function paint(base:string,seed:number){
  const canvas=document.createElement('canvas');canvas.width=canvas.height=512;const c=canvas.getContext('2d')!;c.fillStyle=base;c.fillRect(0,0,512,512)
  let n=seed;const rnd=()=>{n=(n*1664525+1013904223)>>>0;return n/4294967296}
  for(let i=0;i<2500;i++){c.fillStyle=rnd()>.5?'rgba(246,231,195,.06)':'rgba(40,60,50,.04)';c.fillRect(rnd()*512,rnd()*512,2+rnd()*4,1+rnd()*5)}
  for(let i=0;i<30;i++){c.strokeStyle='rgba(216,216,175,.18)';c.lineWidth=.6+rnd();c.beginPath();const y=i*18;for(let x=0;x<=512;x+=10){const yy=y+Math.sin(x*.017+i)*7;if(x===0)c.moveTo(x,yy);else c.lineTo(x,yy)}c.stroke()}
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.wrapS=texture.wrapT=THREE.RepeatWrapping;return texture
 }
 const material=(color:string,seed=1)=>new THREE.MeshStandardMaterial({color:'#ffffff',map:paint(color,seed),roughness:1})
 const earth=material(pigments.earth),stone=material(pigments.green,3),pale=material(pigments.line,8),blue=material(pigments.blue,9),dark=material(pigments.wall,7)
 function add(g:THREE.BufferGeometry,m:THREE.Material,x:number,y:number,z:number){const o=new THREE.Mesh(g,m);o.position.set(x,y,z);o.castShadow=true;o.receiveShadow=true;landscape.add(o);return o}
 function box(w:number,h:number,d:number,x:number,y:number,z:number,m:THREE.Material){return add(new THREE.BoxGeometry(w,h,d),m,x,y,z)}
 // Continuous ridges flank a low, legible route. The city sits in a broad clearing.
 const ground=new THREE.PlaneGeometry(64,75,130,150);ground.rotateX(-Math.PI/2);const pos=ground.getAttribute('position')
 function height(x:number,z:number){const route=Math.sin((18-z)/25*Math.PI)*1.4;const distance=Math.abs(x-route);const sides=Math.pow(Math.max(0,distance-3)/7,1.15);const undulation=1+.25*Math.sin(z*.2+x*.25)+.13*Math.sin(z*.43-x*.19);const cityClear=THREE.MathUtils.smoothstep(z,-12,-4);return Math.min(7,sides*2.5*undulation)*(0.18+.82*cityClear)}
 for(let i=0;i<pos.count;i++)pos.setY(i,height(pos.getX(i),pos.getZ(i)));ground.computeVertexNormals();add(ground,stone,0,-.12,0)
 const road=new THREE.PlaneGeometry(6,58,12,120);road.rotateX(-Math.PI/2);const rp=road.getAttribute('position')
 for(let i=0;i<rp.count;i++){const z=rp.getZ(i);rp.setX(i,rp.getX(i)+Math.sin((18-z)/25*Math.PI)*1.4);rp.setY(i,.02)}road.computeVertexNormals();add(road,earth,0,0,0)
 // Distant ridges frame the destination rather than obscuring it.
 for(const [x,z,h,w] of [[-17,-25,7,11],[15,-28,6,13],[-23,-5,8,12],[23,5,7,14]]){const g=new THREE.SphereGeometry(1,32,18);const p=g.getAttribute('position');for(let i=0;i<p.count;i++)p.setXYZ(i,p.getX(i)*w!,Math.max(0,p.getY(i)+1)*h!/2,p.getZ(i)*5);g.computeVertexNormals();add(g,blue,x!,0,z!)}
 // Open threshold, with the tower clearly visible through it.
 const landform=landscape.children.slice()
 const thresholdStart=landscape.children.length
 box(5.2,2.9,.7,-4.6,1.45,-14,dark);box(5.2,2.9,.7,4.6,1.45,-14,dark)
 for(const x of [-1.65,1.65]){box(.38,3.4,.75,x,1.7,-14,pale);box(.65,.16,1,x,3.4,-14,pale)}
 box(3.5,.32,.8,0,3.3,-14,dark)
 for(const x of [-7,-6,-5,-4,-3,3,4,5,6,7])box(.08,2.4,.03,x,1.65,-13.63,pale)
 // Small stepped stone blocks sit beneath the wall, with no fabricated city streets.
 box(16,.2,2,0,.1,-14,pale)
 const threshold=landscape.children.slice(thresholdStart)
 const loader=new GLTFLoader()
 const definitions=[
  {id:'envoy',url:'/yuezhi/figures/envoy.glb',height:1.75},
  {id:'attendant',url:'/yuezhi/figures/yuezhi.glb',height:1.72},
  {id:'horse',url:'/yuezhi/murals/mural-horse.glb',height:1.9},
  {id:'staff',url:'/yuezhi/figures/han-staff.glb',height:2.7},
  {id:'monk',url:'/mural-assets/monk.glb',height:1.75},
  {id:'tower',url:'/mural-assets/tower.glb',height:7.4},
  {id:'xiongnu',url:'/yuezhi/figures/xiongnu.glb',height:1.72},
  {id:'reception-court',url:'/mural-assets/reception-court.glb',height:0},
  {id:'market',url:'/yuezhi/sets/market-refined.glb',height:0},
  {id:'environment',url:'/yuezhi/environment-refined.glb',height:0},
  {id:'detention-camp',url:'/mural-assets/detention-camp.glb',height:0},
 ]
 const manifestResponse=await fetch('/mural-assets/manifest.json');if(!manifestResponse.ok)throw new Error('场景资产清单无法读取');const manifest=await manifestResponse.json() as {assets:{id:string;bytes:number;sha256:string}[]}
 const supplementResponse=await fetch('/mural-assets/scene-assets-r4.json');if(!supplementResponse.ok)throw new Error('补充场景清单无法读取');const supplement=await supplementResponse.json() as typeof manifest
 manifest.assets.push(...supplement.assets)
 const models=new Map<string,THREE.Group>()
 for(const definition of definitions){const response=await fetch(definition.url);if(!response.ok)throw new Error(`无法读取场景资产：${definition.id}`);const bytes=await response.arrayBuffer();const expected=manifest.assets.find(a=>a.id===definition.id);const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(n=>n.toString(16).padStart(2,'0')).join('');if(!expected||expected.bytes!==bytes.byteLength||expected.sha256!==hash)throw new Error('场景资产校验失败：'+definition.id);const gltf=await loader.parseAsync(bytes,'');const model=gltf.scene;const bounds=new THREE.Box3().setFromObject(model),size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3());if(size.y<.001)throw new Error('资产尺寸无效：'+definition.id);if(definition.height){const scale=definition.height/size.y;model.scale.setScalar(scale);model.position.set(-center.x*scale,-bounds.min.y*scale,-center.z*scale)}model.traverse(object=>{if(object instanceof THREE.Mesh){object.castShadow=true;object.receiveShadow=true}});const root=new THREE.Group();root.add(model);models.set(definition.id,root)}
 const actor=(id:string,x:number,z:number,yaw=0,parent=landscape)=>{const o=models.get(id)!.clone(true);o.position.set(x,0,z);o.rotation.y=yaw;parent.add(o);return o}
 const tower=actor('tower',0,-22);tower.name='mural-tower'
 const monks=[actor('monk',-1.6,-12),actor('monk',1.6,-12)]
 const party=new THREE.Group();landscape.add(party)
 const walkers:WalkRig[]=[]
 let carriedStaff:THREE.Group|undefined
 for(const [id,x,z,height] of [['envoy',0,0,1.75],['attendant',-1.0,1.8,1.72],['attendant',1.05,2.6,1.72],['horse',-1.8,3.5,1.9]] as const){
  const o=models.get(id)!.clone(true)
  const carries=id==='attendant'&&x<0
  // Textured 15-degree front views and six chest/waist bands establish that
  // the attendant's whole body faces +60 degrees, including its face.
  const rig=bindWalkRig(o,height,id==='horse'?'horse':'human',carries,id==='attendant'?-Math.PI/3:0);walkers.push(rig)
  o.position.set(x,.03,z);o.rotation.y=Math.PI;party.add(o)
  if(carries&&rig.rightHand){
   carriedStaff=models.get('staff')!.clone(true);carriedStaff.position.set(.025,-height*.445,.06)
   rig.rightHand.add(carriedStaff)
  }
 }
 const route=new THREE.LineCurve3(new THREE.Vector3(0,0,16),new THREE.Vector3(0,0,-8))
 const routeLength=route.getLength()
 function update(t:number){const progress=THREE.MathUtils.clamp(t,0,1),p=route.getPointAt(progress);party.position.copy(p);const direction=route.getTangentAt(progress);party.rotation.y=Math.atan2(-direction.x,-direction.z);walkers.forEach((rig,index)=>rig.update(progress*routeLength,[0,.31,.68,.13][index]!,progress>=1));for(const monk of monks)monk.rotation.y=greetingYaw(monk.position,p)}
 function view(t:number){const p=route.getPointAt(THREE.MathUtils.clamp(t,0,1));const side=THREE.MathUtils.lerp(2.8,2.0,t);return{position:new THREE.Vector3(p.x+side,2.6,p.z+7.5),target:new THREE.Vector3(p.x,1.4,p.z-4)}}
 function anchors(_t:number):Record<string,THREE.Vector3>{
  group.updateMatrixWorld(true)
  if(currentBeat==='audience')return {party:new THREE.Vector3(-1.55,2,.55),staff:receptionStaff.localToWorld(new THREE.Vector3(0,2.8,0)),'alliance-result':new THREE.Vector3(0,2,-3.8)}
  if(currentBeat==='market'||currentBeat==='goods')return {gate:new THREE.Vector3(0,3,-5),goods:new THREE.Vector3(0,1.4,0),party:new THREE.Vector3(-2,2,1)}
  return{party:party.localToWorld(new THREE.Vector3(0,2.0,0)),staff:carriedStaff?carriedStaff.localToWorld(new THREE.Vector3(0,2.9,0)):party.localToWorld(new THREE.Vector3(-.65,3.0,1.85)),gate:new THREE.Vector3(0,3.6,-14),monks:new THREE.Vector3(-1.6,2.1,-12),tower:new THREE.Vector3(0,7.9,-22)}
 }
 const blockers=[createGuardVariant(models.get('xiongnu')!,'older-mantle',1.74),createGuardVariant(models.get('xiongnu')!,'younger-bow',1.67)]
 blockers[0]!.position.set(-2.65,0,-1.0);blockers[0]!.rotation.y=.68
 blockers[1]!.position.set(2.55,0,-1.65);blockers[1]!.rotation.y=-.60
 camp.add(...blockers)
 actor('detention-camp',0,0,0,camp)
 for(const o of landform)o.visible=false
 actor('environment',0,0)
 actor('reception-court',0,0,0,meeting);actor('market',0,0,0,market)
 let receptionStaff:THREE.Group
 const standing=(id:string,x:number,z:number,yaw:number,parent:THREE.Group,carries=false)=>{
  const o=actor(id,x,z,yaw,parent)
  if(id==='envoy'||id==='attendant'){
   const height=id==='envoy'?1.75:1.72
   const rig=bindWalkRig(o,height,'human',carries,id==='attendant'?-Math.PI/3:0);rig.update(0,0,true)
   if(carries&&rig.rightHand){receptionStaff=models.get('staff')!.clone(true);receptionStaff.position.set(.025,-height*.445,.06);rig.rightHand.add(receptionStaff)}
  }
  return o
 }
 const guests=[standing('envoy',-1.55,.55,Math.PI,meeting),standing('attendant',1.5,.85,Math.PI,meeting,true)]
 guests.forEach(o=>o.position.y=.04)
 // An anonymous representative occupies the principal position. Source texts
 // disagree on the ruler's succession; this figure is not a ruler's portrait.
 const host=standing('attendant',0,-3.8,0,meeting);host.position.y=.225;host.name='Yuezhi court representative - illustrative'
 const courtAttendants=[standing('attendant',-3.1,-4.8,.12,meeting),standing('attendant',3.1,-4.6,-.16,meeting)]
 courtAttendants.forEach((o,index)=>{o.position.y=.20;o.scale.setScalar(index===0?.95:1.03)})
 standing('envoy',-2,1.7,.8,market)
 standing('attendant',2.1,-1.4,-.8,market)
 standing('attendant',-4.4,-3,.6,market)
 // The Blender market already contains its own cloth and two bamboo staffs;
 // the carried Han credential is never substituted for those historical goods.
 let currentBeat:SceneBeatId='mountain'
 const shot=(x:number,y:number,z:number,tx:number,ty:number,tz:number):Shot=>({position:new THREE.Vector3(x,y,z),target:new THREE.Vector3(tx,ty,tz)})
 const lerpShot=(a:Shot,b:Shot,t:number):Shot=>({position:a.position.clone().lerp(b.position,t),target:a.target.clone().lerp(b.target,t)})
 function present(beat:SceneBeatId,t:number):Shot{
  currentBeat=beat;const u=THREE.MathUtils.clamp(t,0,1),ease=u*u*(3-2*u)
  const inMeeting=beat==='audience',inMarket=beat==='market'||beat==='goods',inCamp=beat==='detention'||beat==='retained-credential'
  landscape.visible=!inMeeting&&!inMarket&&!inCamp;meeting.visible=inMeeting;market.visible=inMarket;camp.visible=inCamp
  // Move the existing skinned party, preserving bone bindings and held credential.
  if(party.parent!==(inCamp?camp:landscape))(inCamp?camp:landscape).add(party)
  const city=beat==='city'||beat==='greeting'||beat==='tower'
  for(const o of threshold)o.visible=city
  tower.visible=city;monks.forEach(o=>o.visible=beat==='greeting'||beat==='tower')
  blockers.forEach(o=>o.visible=beat==='detention'||beat==='retained-credential')
  if(inMeeting)return lerpShot(shot(7,4.1,9,0,1.1,-2.1),shot(5.7,2.65,6.2,0,1.15,-2.35),ease)
  if(beat==='market')return lerpShot(shot(9,6.7,10,0,.8,0),shot(6.5,4.7,7,0,1,0),ease)
  if(beat==='goods')return lerpShot(shot(3,2.7,3,0,.8,0),shot(1.8,1.9,2.1,.2,.8,0),ease)
  party.children.forEach((o,index)=>{o.visible=index!==3||!inCamp;o.position.y=inCamp?.008:.03})
  let from=8,to=3
  if(beat==='westward'){from=3;to=-3}
  if(beat==='city'){from=0;to=-5.4}
  if(beat==='greeting'){from=-5.4;to=-8.3}
  if(beat==='tower'){from=-8.3;to=-8.3}
  if(beat==='detention'){from=2.5;to=1.3}
  if(beat==='credential'){from=7.8;to=7.8}
  if(beat==='retained-credential'){from=1.3;to=1.3}
  const distance=(from-to)*ease
  party.position.set(0,0,from-distance);party.rotation.y=0
  walkers.forEach((rig,index)=>rig.update(distance,[0,.31,.68,.13][index]!,u>=1||from===to,1-THREE.MathUtils.smoothstep(u,.86,1)))
  for(const monk of monks)monk.rotation.y=greetingYaw(monk.position,party.position)
  if(beat==='credential')return lerpShot(shot(-4.3,2.8,11.6,-.7,1.9,9.2),shot(-3.2,2.3,10.5,-.7,1.9,9.2),ease)
  if(beat==='retained-credential')return lerpShot(shot(-4.8,2.8,6.7,-.5,1.6,1),shot(-3.5,2.2,5.4,-.5,1.6,1),ease)
  if(beat==='detention')return lerpShot(shot(5.8,4.1,10.2,0,1,-2),shot(3.2,2.8,9.6,0,1,-1),ease)
  if(beat==='greeting')return shot(4.7,2.7,-6.6,0,1.3,-10.8)
  if(beat==='tower')return lerpShot(shot(5,3,-9,0,2,-17),shot(4,4.3,-11,0,4,-22),ease)
  return shot(3.2,2.5,party.position.z+8.6,0,1.1,party.position.z-2)
 }
 return{group,update,camera:view,present,anchors,motion:()=>walkers.map(rig=>rig.state()),assetCount:definitions.length}
}
