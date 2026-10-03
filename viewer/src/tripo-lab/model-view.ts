import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

export type ViewMode = 'material' | 'normal' | 'wireframe'
export type ViewPose = {position:THREE.Vector3;target:THREE.Vector3}

/** Reclaim parsed assets when a refresh, pair switch or stale request replaces them. */
export function disposeModel(model:THREE.Object3D){
 const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>(),textures=new Set<THREE.Texture>()
 model.traverse(object=>{if(object instanceof THREE.Mesh){geometries.add(object.geometry);for(const material of Array.isArray(object.material)?object.material:[object.material])materials.add(material)}})
 for(const material of materials)for(const value of Object.values(material))if(value instanceof THREE.Texture)textures.add(value)
 geometries.forEach(geometry=>geometry.dispose());materials.forEach(material=>material.dispose())
 textures.forEach(texture=>{const source=texture.image;if(typeof ImageBitmap!=='undefined'&&source instanceof ImageBitmap)source.close();texture.dispose()})
}

/** On-demand rendering: there is no idle animation loop or auto rotation. */
export class ModelView{
 private renderer:THREE.WebGLRenderer
 private scene=new THREE.Scene()
 private camera=new THREE.PerspectiveCamera(36,1,.01,100)
 private controls:OrbitControls
 private observer:ResizeObserver
 private frame=0
 private disposed=false
 private copying=false
 private materials=new Map<THREE.Mesh,THREE.Material|THREE.Material[]>()
 private normal=new THREE.MeshNormalMaterial()
 private wireframe=new THREE.MeshBasicMaterial({color:'#dec28b',wireframe:true})
 private floor:THREE.Mesh
 private visibility=()=>{if(document.hidden){cancelAnimationFrame(this.frame);this.frame=0}else this.render()}
 constructor(private host:HTMLElement,private model:THREE.Group,bounds:THREE.Box3,scale:number,onChange:(pose:ViewPose)=>void){
  this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:false})
  this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));this.renderer.outputColorSpace=THREE.SRGBColorSpace
  this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1
  this.renderer.domElement.setAttribute('aria-label','真实 Tripo 模型；拖动旋转，滚轮缩放')
  host.append(this.renderer.domElement)
  this.scene.background=new THREE.Color('#1e2723')
  this.scene.add(new THREE.HemisphereLight('#f1e4cc','#394834',2.3))
  const light=new THREE.DirectionalLight('#ffe3b0',3.2);light.position.set(4,5,3);this.scene.add(light)
  const fill=new THREE.DirectionalLight('#b8c8df',.75);fill.position.set(-4,2,-3);this.scene.add(fill)
  this.floor=new THREE.Mesh(new THREE.CircleGeometry(3.7,64),new THREE.MeshStandardMaterial({color:'#324137',roughness:1}))
  this.floor.rotation.x=-Math.PI/2;this.floor.position.y=-.012;this.scene.add(this.floor)
  const center=bounds.getCenter(new THREE.Vector3())
  const wrapper=new THREE.Group();wrapper.scale.setScalar(scale)
  wrapper.position.set(-center.x*scale,-bounds.min.y*scale,-center.z*scale);wrapper.add(model);this.scene.add(wrapper)
  model.traverse(object=>{if(object instanceof THREE.Mesh)this.materials.set(object,object.material)})
  this.controls=new OrbitControls(this.camera,this.renderer.domElement)
  this.controls.enableDamping=false;this.controls.minDistance=.2;this.controls.maxDistance=18
  this.controls.addEventListener('change',()=>{this.render();if(!this.copying)onChange(this.pose())})
  this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(host)
  document.addEventListener('visibilitychange',this.visibility)
  this.reset();this.resize()
 }
 private pose():ViewPose{return{position:this.camera.position.clone(),target:this.controls.target.clone()}}
 setPose(pose:ViewPose){
  this.copying=true;this.camera.position.copy(pose.position);this.controls.target.copy(pose.target);this.controls.update();this.copying=false;this.render()
 }
 reset(){this.setPose({position:new THREE.Vector3(3.5,2.4,5.5),target:new THREE.Vector3(0,1.3,0)})}
 setMode(mode:ViewMode){for(const [mesh,material] of this.materials)mesh.material=mode==='normal'?this.normal:mode==='wireframe'?this.wireframe:material;this.render()}
 private resize(){
  if(this.disposed)return
  const rect=this.host.getBoundingClientRect();if(rect.width<=0||rect.height<=0)return
  this.camera.aspect=rect.width/rect.height;this.camera.updateProjectionMatrix();this.renderer.setSize(rect.width,rect.height,false);this.render()
 }
 private render(){
  if(this.disposed||document.hidden||this.frame)return
  this.frame=requestAnimationFrame(()=>{this.frame=0;if(!this.disposed&&!document.hidden)this.renderer.render(this.scene,this.camera)})
 }
 dispose(){
  if(this.disposed)return
  this.disposed=true;cancelAnimationFrame(this.frame);this.observer.disconnect();document.removeEventListener('visibilitychange',this.visibility)
  this.controls.dispose()
  // Restore original materials before disposing them, then release shared
  // diagnostic materials once; mode switches never mutate provider materials.
  for(const [mesh,material] of this.materials)mesh.material=material
  disposeModel(this.model);this.normal.dispose();this.wireframe.dispose();disposeModel(this.floor)
  this.renderer.dispose();this.renderer.forceContextLoss();this.renderer.domElement.remove()
 }
}
