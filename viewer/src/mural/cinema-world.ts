import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { bindWalkRig, type WalkRig } from './walking.ts'
import type {SceneBeatId} from './scene-beats.ts'
import { addMarketDetails } from './market-details.ts'
import {createGuardVariant} from './guard-variants.ts'
type Shot = {position:THREE.Vector3;target:THREE.Vector3}
export type CinemaWorld = {group:THREE.Group; update:(progress:number)=>void; camera:(progress:number)=>Shot; present:(beat:SceneBeatId,progress:number,ambientSeconds?:number)=>Shot; anchors:(progress:number)=>Record<string,THREE.Vector3>; focusBounds:(ids:string[])=>THREE.Box3[]; characterNames:()=>{name:string;point:THREE.Vector3}[]; motion:()=>ReturnType<WalkRig['state']>[]; assetCount:number}

// The preserved monk mesh's textured face points along local +X. Turn the
// whole figure toward the incoming party, with the two hosts looking inward.
export function greetingYaw(host:THREE.Vector3,guest:THREE.Vector3){return Math.atan2(guest.x-host.x,guest.z-host.z)-Math.PI/2}

// A composed interpretation of the mural's mountain passage and city threshold.
export async function createCinemaWorld():Promise<CinemaWorld>{
 const group=new THREE.Group();group.visible=false
 const landscape=new THREE.Group(),meeting=new THREE.Group(),market=new THREE.Group(),camp=new THREE.Group(),background=new THREE.Group()
 group.add(background,landscape,meeting,market,camp)
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
 // Preserve the mural-led straight entrance, with authored material and edge
 // details. These are display additions, not an excavated city-wall design.
 const masonryMap=paint(pigments.wall,71)
 const masonryCanvas=masonryMap.image as HTMLCanvasElement
 const masonryContext=masonryCanvas.getContext('2d')!
 for(let row=0;row<8;row++){
  const y=row*64;masonryContext.fillStyle='rgba(30,39,37,.38)';masonryContext.fillRect(0,y,512,2)
  for(let column=-1;column<5;column++){
   const x=column*128+(row%2)*64
   masonryContext.fillRect(x,y,2,64)
   masonryContext.fillStyle='rgba(213,197,158,.11)';masonryContext.fillRect(x+3,y+3,122,1)
   masonryContext.fillStyle='rgba(30,39,37,.38)'
  }
 }
 masonryMap.needsUpdate=true
 const masonry=new THREE.MeshStandardMaterial({map:masonryMap,roughness:.98,bumpMap:masonryMap,bumpScale:.025})
 const wallPart=(name:string,w:number,h:number,d:number,x:number,y:number,z:number,m:THREE.Material,radius=.045)=>{
  const mesh=add(new RoundedBoxGeometry(w,h,d,2,radius),m,x,y,z);mesh.name=name
  mesh.userData.historicalStatus='Authored mural-inspired architectural detail; illustrative form'
  return mesh
 }
 for(const side of [-1,1]){
  wallPart('Mural city wall - worn masonry',5.2,2.9,1.05,side*4.6,1.45,-14,masonry,.085)
  wallPart('Mural city wall - coping',5.4,.20,1.23,side*4.6,2.95,-14,pale)
  wallPart('Mural city wall - lower plinth',5.4,.28,1.25,side*4.6,.14,-14,pale)
  wallPart('Mural city entrance - inner jamb',.38,3.4,1.45,side*1.65,1.7,-14,pale)
  wallPart('Mural city entrance - jamb cap',.65,.16,1.64,side*1.65,3.4,-14,pale)
 }
 wallPart('Mural city entrance - stone lintel',3.5,.32,1.55,0,3.3,-14,pale)
 wallPart('Mural city entrance - lintel edge',3.7,.12,1.67,0,3.5,-14,dark)
 // Instance repeated parapet blocks and jamb courses, sharing geometry and
 // materials rather than creating a draw call for each architectural detail.
 const repeated=(name:string,w:number,h:number,d:number,positions:THREE.Vector3[],m:THREE.Material)=>{
  const mesh=new THREE.InstancedMesh(new RoundedBoxGeometry(w,h,d,1,.025),m,positions.length)
  const matrix=new THREE.Matrix4()
  positions.forEach((p,index)=>{mesh.setMatrixAt(index,matrix.makeTranslation(p.x,p.y,p.z));mesh.setColorAt(index,new THREE.Color().setScalar(.91+(index%4)*.025))})
  mesh.name=name;mesh.castShadow=mesh.receiveShadow=true;landscape.add(mesh)
 }
 repeated('Mural city wall - illustrative parapet',.55,.43,1.0,[-7,-6.1,-5.2,-4.3,-3.4,-2.5,2.5,3.4,4.3,5.2,6.1,7].map(x=>new THREE.Vector3(x,3.25,-14)),masonry)
 repeated('Mural city entrance - visible stone courses',.43,.29,.05,[-1.65,1.65].flatMap(x=>Array.from({length:10},(_,row)=>new THREE.Vector3(x,.2+row*.31,-13.25))),pale)
 wallPart('Mural city entrance - worn approach',16,.16,2.4,0,.08,-14,pale)
 const threshold=landscape.children.slice(thresholdStart)
 const loader=new GLTFLoader()
 const definitions=[
  {id:'envoy',url:'/yuezhi/figures/envoy.glb',height:1.75},
  {id:'attendant',url:'/yuezhi/figures/yuezhi.glb',height:1.72},
  {id:'horse',url:'/yuezhi/murals/mural-horse.glb',height:1.9},
  {id:'staff',url:'/tripo-prompt-lab/staff-b.glb',height:1.8},
  {id:'gate',url:'/tripo-prompt-lab/gate-b.glb',height:3.7},
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
 const generatedResponse=await fetch('/tripo-prompt-lab/results.json')
 if(!generatedResponse.ok)throw new Error('Tripo生成资产清单无法读取')
 const generated=await generatedResponse.json() as {cases:{id:string;path:string;status:string;bytes:number;sha256:string}[]}
 for(const [id,caseId] of [['staff','staff-b'],['gate','gate-b']] as const){
  const record=generated.cases.find(item=>item.id===caseId&&item.status==='downloaded')
  if(!record||record.path!==`/tripo-prompt-lab/${caseId}.glb`)throw new Error('Tripo生成资产记录不匹配：'+caseId)
  manifest.assets=manifest.assets.filter(item=>item.id!==id)
  manifest.assets.push({id,bytes:record.bytes,sha256:record.sha256})
 }
 const models=new Map<string,THREE.Group>()
 for(const definition of definitions){const response=await fetch(definition.url);if(!response.ok)throw new Error(`无法读取场景资产：${definition.id}`);const bytes=await response.arrayBuffer();const expected=manifest.assets.find(a=>a.id===definition.id);const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(n=>n.toString(16).padStart(2,'0')).join('');if(!expected||expected.bytes!==bytes.byteLength||expected.sha256!==hash)throw new Error('场景资产校验失败：'+definition.id);const gltf=await loader.parseAsync(bytes,'');const model=gltf.scene;if(definition.id==='staff'){/* Align the generated shaft's principal axis to the held staff's local Y. */model.quaternion.setFromUnitVectors(new THREE.Vector3(-.356650382,.677891374,-.642855942).normalize(),new THREE.Vector3(0,1,0));model.updateMatrixWorld(true)}const bounds=new THREE.Box3().setFromObject(model),size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3());if(size.y<.001)throw new Error('资产尺寸无效：'+definition.id);if(definition.height){const scale=definition.height/size.y;model.scale.setScalar(scale);model.position.set(-center.x*scale,-bounds.min.y*scale,-center.z*scale)}model.traverse(object=>{if(object instanceof THREE.Mesh){object.castShadow=true;object.receiveShadow=true}});const root=new THREE.Group();root.add(model);models.set(definition.id,root)}
 const actor=(id:string,x:number,z:number,yaw=0,parent=landscape)=>{const o=models.get(id)!.clone(true);o.position.set(x,0,z);o.rotation.y=yaw;parent.add(o);return o}
 const generatedGate=actor('gate',0,-14,Math.PI/2);generatedGate.name='Tripo gate-b';generatedGate.visible=false
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
  if(currentBeat==='audience')return {party:new THREE.Vector3(-1.55,2,.55),staff:receptionStaff.localToWorld(new THREE.Vector3(0,1.8,0)),'alliance-result':new THREE.Vector3(0,2,-3.8)}
  if(currentBeat==='market'||currentBeat==='goods')return {gate:new THREE.Vector3(0,3,-5),goods:new THREE.Vector3(0,1.4,0),party:new THREE.Vector3(-2,2,1)}
  if(currentBeat==='detention'||currentBeat==='retained-credential')return {
   party:party.localToWorld(new THREE.Vector3(0,2,0)),
   staff:carriedStaff?carriedStaff.localToWorld(new THREE.Vector3(0,1.8,0)):party.localToWorld(new THREE.Vector3(-.65,3,1.85)),
   detention:new THREE.Vector3(0,2.6,-4.25),
   guard:blockers[0]!.localToWorld(new THREE.Vector3(0,2,0)),
  }
  return{party:party.localToWorld(new THREE.Vector3(0,2.0,0)),staff:carriedStaff?carriedStaff.localToWorld(new THREE.Vector3(0,1.8,0)):party.localToWorld(new THREE.Vector3(-.65,3.0,1.85)),gate:new THREE.Vector3(0,3.6,-14),monks:new THREE.Vector3(-1.6,2.1,-12),tower:new THREE.Vector3(0,7.9,-22)}
 }
 function characterNames():{name:string;point:THREE.Vector3}[]{
  group.updateMatrixWorld(true)
  // Only the lead envoy has an identified role; attendants stay anonymous.
  const envoy=currentBeat==='audience'?guests[0]!:currentBeat==='market'||currentBeat==='goods'?marketPeople[0]!:party.children[0]!
  for(let ancestor:THREE.Object3D|null=envoy;ancestor;ancestor=ancestor.parent)if(!ancestor.visible)return []
  const box=new THREE.Box3().setFromObject(envoy)
  return [{name:'张骞',point:new THREE.Vector3((box.min.x+box.max.x)/2,box.max.y+.12,(box.min.z+box.max.z)/2)}]
 }
 function focusBounds(ids:string[]):THREE.Box3[]{
  if(!group.visible)return []
  group.updateMatrixWorld(true)
  const inCamp=currentBeat==='detention'||currentBeat==='retained-credential'
  const inMarket=currentBeat==='market'||currentBeat==='goods'
  const inMeeting=currentBeat==='audience'
  const atCity=currentBeat==='city'||currentBeat==='greeting'||currentBeat==='tower'
  const results:THREE.Box3[]=[]
  const entity=(object:THREE.Object3D|undefined)=>{
   if(!object)return
   // Ancestor visibility matters for meshes that remain loaded in other sets.
   for(let ancestor:THREE.Object3D|null=object;ancestor;ancestor=ancestor.parent)if(!ancestor.visible)return
   // Non-precise bounds retain the cached local mesh envelope; a small margin
   // covers gait deformation without traversing every skinned vertex per frame.
   const bounds=new THREE.Box3().setFromObject(object).expandByScalar(.10)
   if(!bounds.isEmpty())results.push(bounds)
  }
  const approximate=(x:number,y:number,z:number,w:number,h:number,d:number)=>{
   results.push(new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(x,y,z),new THREE.Vector3(w,h,d)))
  }
  for(const id of new Set(ids)){
   if(id==='party')entity(inMeeting?guests[0]:inMarket?marketPeople[0]:party.children[0])
   else if(id==='staff'&&!inMarket)entity(inMeeting?receptionStaff:carriedStaff)
   else if(id==='guard'&&inCamp)blockers.forEach(entity)
   else if(id==='detention'&&inCamp)approximate(0,1.5,-4,6,3,4)
   else if(id==='gate'&&atCity)entity(generatedGate)
   else if(id==='goods'&&inMarket)approximate(0,.8,0,3.6,1.6,2)
   else if(id==='market-people'&&inMarket){entity(marketPeople[3]);entity(marketPeople[5])}
   else if(id==='monks'&&(currentBeat==='greeting'||currentBeat==='tower'))monks.forEach(entity)
   else if(id==='tower'&&atCity)entity(tower)
  }
  return results
 }
 const blockers=[createGuardVariant(models.get('xiongnu')!,'older-mantle',1.74),createGuardVariant(models.get('xiongnu')!,'younger-bow',1.67)]
 // Keep the original textured Tripo body and authored accessories together;
 // short steps, rather than sliding static figures, make the interception clear.
 // The variants are already skinned. Rebinding their tiny accessory meshes
 // would run the foot sampler on meshes without soles; animate their existing
 // leg bones instead and leave the accessory/hand bindings untouched.
 const guardSteps=blockers.map(guard=>{
  const pelvis=guard.getObjectByName('walk-pelvis')!
  const restY=pelvis.position.y
  const legs=['left','right'].map(side=>({
   thigh:guard.getObjectByName(side+'-thigh')!,
   shin:guard.getObjectByName(side+'-shin')!,
   foot:guard.getObjectByName(side+'-foot')!,
  }))
  const skeletons=new Set<THREE.Skeleton>()
  guard.traverse(o=>{if(o instanceof THREE.SkinnedMesh)skeletons.add(o.skeleton)})
  return (distance:number,offset:number,stopped:boolean)=>{
   const weight=stopped?0:THREE.MathUtils.smoothstep(distance,0,.2)
   const phase=distance/.55*Math.PI*2+offset*Math.PI*2
   pelvis.position.y=restY+(1-Math.cos(phase*2))*.003*weight
   for(const [index,leg] of legs.entries()){
    const swing=Math.sin(phase+index*Math.PI)
    leg.thigh.rotation.x=swing*.17*weight
    leg.shin.rotation.x=Math.max(0,swing)*.24*weight
    leg.foot.rotation.x=-leg.thigh.rotation.x-leg.shin.rotation.x
   }
   guard.updateMatrixWorld(true);skeletons.forEach(skeleton=>skeleton.update())
  }
 })
 camp.add(...blockers)
 actor('detention-camp',0,0,0,camp)
 for(const o of landform)o.visible=false
 // One existing environment supplies the horizon for every scene. Local sets
 // keep their own authored ground at Y0, above this slightly lowered background.
 const environment=actor('environment',0,0,0,background)
 actor('reception-court',0,0,0,meeting);actor('market',0,0,0,market);addMarketDetails(market)
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
 const marketPeople=[
  standing('envoy',-2,1.7,.8,market),
  standing('attendant',2.1,-1.4,-.8,market),
  standing('attendant',-4.4,-3,0,market),
  standing('attendant',4.5,-2.9,0,market),
  standing('attendant',-4.8,-.2,Math.PI,market),
  standing('attendant',4.9,-.2,Math.PI,market),
  standing('envoy',6.8,-2.0,-.6,market),
 ]
 marketPeople.forEach((person,index)=>{
  person.name=index===2||index===3?'Market stall keeper - illustrative':'Market visitor - illustrative'
  person.position.y=.025;person.scale.setScalar(.94+(index%4)*.025)
 })
 // The delivered market script places stalls at X ±4.5, Z -1.7, the
 // central historical goods at the origin, and the back wall at Z -4.
 // Two slow loops occupy the clear forecourt, never crossing these objects.
 const marketPassers=[[-4,2.8,1.6,.7,0],[4.6,2.0,1.4,.8,Math.PI]] as const
 const marketWalkers=marketPassers.map(([x,z,rx,rz,phase],index)=>{
  const id=index===0?'attendant':'envoy',height=id==='attendant'?1.72:1.75
  const person=models.get(id)!.clone(true)
  const rig=bindWalkRig(person,height,'human',false,id==='attendant'?-Math.PI/3:0)
  person.name='Market moving visitor - illustrative';market.add(person)
  return{person,rig,x,z,rx,rz,phase}
 })
 const marketHeads=marketPeople.map(person=>({person,head:person.getObjectByName('walk-head')!,spine:person.getObjectByName('walk-spine')!}))
 function animateMarket(seconds:number){
  const time=Number.isFinite(seconds)?Math.max(0,seconds):0
  for(const [index,visitor] of marketWalkers.entries()){
   const phase=time*.105+visitor.phase
   visitor.person.position.set(visitor.x+visitor.rx*Math.cos(phase),.025,visitor.z+visitor.rz*Math.sin(phase))
   visitor.person.rotation.y=Math.atan2(-visitor.rx*Math.sin(phase),visitor.rz*Math.cos(phase))
   // Arc-length table would be excessive for these small, slow loops; the
   // mean ellipse radius keeps captured steps within their visible travel.
   visitor.rig.update(time*.105*(visitor.rx+visitor.rz)*.5,index*.37,time===0)
  }
  for(const [index,{person,head,spine}] of marketHeads.entries()){
   head.rotation.y=Math.sin(time*.48+index)*.10
   spine.rotation.y=Math.sin(time*.29+index*.73)*.035
   if(index===3||index===5){
    const arm=person.getObjectByName('right-arm')!,forearm=arm.getObjectByName('forearm')!
    arm.rotation.x=-.50+Math.sin(time*.65+index)*.06
    forearm.rotation.x=-.65+Math.sin(time*.65+index)*.08
   }
   person.updateMatrixWorld(true)
  }
 }
 // The Blender market already contains its own cloth and two bamboo staffs;
 // the carried Han credential is never substituted for those historical goods.
 let currentBeat:SceneBeatId='mountain'
 const shot=(x:number,y:number,z:number,tx:number,ty:number,tz:number):Shot=>({position:new THREE.Vector3(x,y,z),target:new THREE.Vector3(tx,ty,tz)})
 const lerpShot=(a:Shot,b:Shot,t:number):Shot=>({position:a.position.clone().lerp(b.position,t),target:a.target.clone().lerp(b.target,t)})
 function present(beat:SceneBeatId,t:number,ambientSeconds=0):Shot{
  currentBeat=beat;const u=THREE.MathUtils.clamp(t,0,1),ease=u*u*(3-2*u)
  const inMeeting=beat==='audience',inMarket=beat==='market'||beat==='goods',inCamp=beat==='detention'||beat==='retained-credential'
  landscape.visible=!inMeeting&&!inMarket&&!inCamp;meeting.visible=inMeeting;market.visible=inMarket;camp.visible=inCamp
  environment.position.y=inMeeting||inMarket||inCamp?-.14:0
  // Move the existing skinned party, preserving bone bindings and held credential.
  if(party.parent!==(inCamp?camp:landscape))(inCamp?camp:landscape).add(party)
  const city=beat==='city'||beat==='greeting'||beat==='tower'
  for(const o of threshold)o.visible=city&&o.name.startsWith('Mural city wall')
  generatedGate.visible=city
  tower.visible=city;monks.forEach(o=>o.visible=beat==='greeting'||beat==='tower')
  blockers.forEach(o=>o.visible=beat==='detention'||beat==='retained-credential')
  if(inMarket)animateMarket(ambientSeconds)
  if(inMeeting)return lerpShot(shot(7,4.1,9,0,1.1,-2.1),shot(5.7,2.65,6.2,0,1.15,-2.35),ease)
  if(beat==='market')return lerpShot(shot(9,6.7,10,0,.8,0),shot(8.3,3.4,5.4,3.4,1.05,-1.4),ease)
  if(beat==='goods')return lerpShot(shot(3,2.7,3,0,.8,0),shot(1.8,1.9,2.1,.2,.8,0),ease)
  party.children.forEach((o,index)=>{o.visible=index!==3||!inCamp;o.position.y=inCamp?.008:.03})
  let from=8,to=3
  if(beat==='westward'){from=3;to=-3}
  if(beat==='city'){from=0;to=-5.4}
  if(beat==='greeting'){from=-5.4;to=-8.3}
  if(beat==='tower'){from=-8.3;to=-8.3}
  if(beat==='opening'){from=7.8;to=7.8}
  if(beat==='credential'){from=7.8;to=7.8}
  if(beat==='retained-credential'){from=-.8;to=-.8}
  if(inCamp){
   // An illustrative sequence, not a documented camp plan: approach, halt
   // before guards, then escorted movement into a restricted camp space.
   // The actual camp asset has a clear central square (X/Z ±4) and its first
   // shelter begins at Z -4.25. All four trajectories stay clear of these props.
   const approach=THREE.MathUtils.smoothstep(u,0,.28)
   const interception=THREE.MathUtils.smoothstep(u,.16,.34)
   const escort=THREE.MathUtils.smoothstep(u,.48,.9)
   const retained=beat==='retained-credential'
   const partyZ=retained?-.8:8-3.5*approach-5.3*escort
   const distance=8-partyZ
   party.position.set(0,0,partyZ);party.rotation.y=0
   const paused=retained||(u>=.28&&u<=.48)||u>=.9
   const weight=u<.28?1-THREE.MathUtils.smoothstep(u,.23,.28):1-THREE.MathUtils.smoothstep(u,.85,.9)
   walkers.forEach((rig,index)=>rig.update(distance,[0,.31,.68,.13][index]!,paused,weight))
   for(const [index,guard] of blockers.entries()){
    const side=index===0?-1:1
    const x=retained?side*2.3:side*(2.65-1.55*interception+1.2*escort)
    const z=retained?3.8:3.4+.4*escort
    guard.position.set(x,.008,z)
    // Face the approaching party, turn to accompany it, then face its exit.
    guard.rotation.y=retained?Math.PI:THREE.MathUtils.lerp(-side*.24,Math.PI,escort)
    const guardDistance=1.55*interception+Math.hypot(1.2,.4)*escort
    guardSteps[index]!(guardDistance,index*.31,retained||u<=.16||(u>=.34&&u<=.48)||u>=.9)
   }
   camp.userData.detentionPhase=retained||u>=.9?'restricted':u>=.48?'escorted':u>=.28?'intercepted':'approaching'
   if(retained)return lerpShot(shot(-5.3,3.2,5.4,-.4,1.5,-.4),shot(-3.8,2.3,4.5,-.5,1.6,-.3),ease)
   // Start with the route and guards together, finish with the party enclosed
   // by the camp and the two guards between it and the outward route.
   return lerpShot(shot(8.8,5.2,13,0,1.2,2),shot(6.4,3.8,7.8,0,1,-1.6),ease)
  }
  const distance=(from-to)*ease
  party.position.set(0,0,from-distance);party.rotation.y=0
  walkers.forEach((rig,index)=>rig.update(distance,[0,.31,.68,.13][index]!,u>=1||from===to,1-THREE.MathUtils.smoothstep(u,.86,1)))
  for(const monk of monks)monk.rotation.y=greetingYaw(monk.position,party.position)
  if(beat==='opening')return shot(-5.5,3.2,3.5,-.3,1.5,9)
  if(beat==='credential')return lerpShot(shot(-4.3,2.8,11.6,-.7,1.9,9.2),shot(-4.6,2.8,12,-.7,1.5,9.2),ease)
  if(beat==='greeting')return shot(4.7,2.7,-6.6,0,1.3,-10.8)
  if(beat==='tower')return lerpShot(shot(5,3,-9,0,2,-17),shot(4,4.3,-11,0,4,-22),ease)
  return shot(3.2,2.5,party.position.z+8.6,0,1.1,party.position.z-2)
 }
 return{group,update,camera:view,present,anchors,focusBounds,characterNames,motion:()=>walkers.map(rig=>rig.state()),assetCount:definitions.length}
}
