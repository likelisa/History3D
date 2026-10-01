import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
export type CinemaWorld = {group:THREE.Group; update:(progress:number)=>void; camera:(progress:number)=>{position:THREE.Vector3;target:THREE.Vector3}; assetCount:number}

// A composed interpretation of the mural's mountain passage and city threshold.
export async function createCinemaWorld():Promise<CinemaWorld>{
 const group=new THREE.Group();group.visible=false
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
 function add(g:THREE.BufferGeometry,m:THREE.Material,x:number,y:number,z:number){const o=new THREE.Mesh(g,m);o.position.set(x,y,z);o.castShadow=true;o.receiveShadow=true;group.add(o);return o}
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
 box(5.2,2.9,.7,-4.6,1.45,-14,dark);box(5.2,2.9,.7,4.6,1.45,-14,dark)
 for(const x of [-1.65,1.65]){box(.38,3.4,.75,x,1.7,-14,pale);box(.65,.16,1,x,3.4,-14,pale)}
 box(3.5,.32,.8,0,3.3,-14,dark)
 for(const x of [-7,-6,-5,-4,-3,3,4,5,6,7])box(.08,2.4,.03,x,1.65,-13.63,pale)
 // Small stepped stone blocks sit beneath the wall, with no fabricated city streets.
 box(16,.2,2,0,.1,-14,pale)
 const loader=new GLTFLoader()
 const definitions=[
  {id:'envoy',url:'/yuezhi/figures/envoy.glb',height:1.75},
  {id:'attendant',url:'/yuezhi/figures/yuezhi.glb',height:1.72},
  {id:'horse',url:'/yuezhi/murals/mural-horse.glb',height:1.9},
  {id:'staff',url:'/yuezhi/figures/han-staff.glb',height:2.7},
  {id:'monk',url:'/mural-assets/monk.glb',height:1.75},
  {id:'tower',url:'/mural-assets/tower.glb',height:7.4},
 ]
 const manifestResponse=await fetch('/mural-assets/manifest.json');if(!manifestResponse.ok)throw new Error('场景资产清单无法读取');const manifest=await manifestResponse.json() as {assets:{id:string;bytes:number;sha256:string}[]}
 const models=new Map<string,THREE.Group>()
 for(const definition of definitions){const response=await fetch(definition.url);if(!response.ok)throw new Error(`无法读取场景资产：${definition.id}`);const bytes=await response.arrayBuffer();const expected=manifest.assets.find(a=>a.id===definition.id);const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(n=>n.toString(16).padStart(2,'0')).join('');if(!expected||expected.bytes!==bytes.byteLength||expected.sha256!==hash)throw new Error('场景资产校验失败：'+definition.id);const gltf=await loader.parseAsync(bytes,'');const model=gltf.scene;const bounds=new THREE.Box3().setFromObject(model),size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3());if(size.y<.001)throw new Error('资产尺寸无效：'+definition.id);const scale=definition.height/size.y;model.scale.setScalar(scale);model.position.set(-center.x*scale,-bounds.min.y*scale,-center.z*scale);model.traverse(object=>{if(object instanceof THREE.Mesh){object.castShadow=true;object.receiveShadow=true;const mats=Array.isArray(object.material)?object.material:[object.material];for(const m of mats){if(m instanceof THREE.MeshStandardMaterial){m.roughness=.95;m.metalness=0}}}});const root=new THREE.Group();root.add(model);models.set(definition.id,root)}
 const actor=(id:string,x:number,z:number,yaw=0)=>{const o=models.get(id)!.clone(true);o.position.set(x,0,z);o.rotation.y=yaw;group.add(o);return o}
 const tower=actor('tower',0,-22);tower.name='mural-tower'
 actor('monk',-1.6,-12,.15);actor('monk',1.6,-12,-.15)
 const party=new THREE.Group();group.add(party)
 for(const [id,x,z,yaw] of [['envoy',0,0,Math.PI],['attendant',-1.0,1.8,Math.PI],['attendant',1.05,2.6,Math.PI],['horse',-1.8,3.5,Math.PI/2],['staff',-.65,1.85,0]] as const){const o=models.get(id)!.clone(true);o.position.set(x,0,z);o.rotation.y=yaw;party.add(o)}
 const route=new THREE.CatmullRomCurve3([new THREE.Vector3(0,0,16),new THREE.Vector3(1.0,0,9),new THREE.Vector3(.7,0,1),new THREE.Vector3(0,0,-8)])
 function update(t:number){const p=route.getPoint(THREE.MathUtils.clamp(t,0,1));party.position.copy(p);const direction=route.getTangent(THREE.MathUtils.clamp(t,0,1));party.rotation.y=Math.atan2(-direction.x,-direction.z)}
 function view(t:number){const p=route.getPoint(THREE.MathUtils.clamp(t,0,1));const side=THREE.MathUtils.lerp(2.8,2.0,t);return{position:new THREE.Vector3(p.x+side,2.6,p.z+7.5),target:new THREE.Vector3(p.x,1.4,p.z-4)}}
 return{group,update,camera:view,assetCount:definitions.length}
}
