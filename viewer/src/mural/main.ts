import * as THREE from 'three'
import { createCinemaWorld } from './cinema-world.ts'
import type { CinemaWorld } from './cinema-world.ts'
import { chapters, duration } from './story.ts'
import './style.css'
const config = { width: 21.72, height: 18, source: '/yuezhi/murals/full.jpg', cameraZ: 29 }
type Layer = { name: string; depth: number; points: number[][]; detail?: string }
const layers: Layer[] = [
  { name: '城池与佛塔', depth: 1.2, points: [[17,27],[179,16],[215,71],[213,166],[170,195],[63,199],[18,146]], detail: '壁画左上可见城池与佛塔。此处沿可见轮廓建立浅层厚度，城内布局与建筑背面未复原。' },
  { name: '远山', depth: 1.8, points: [[278,25],[326,47],[359,25],[409,57],[445,133],[393,157],[310,131],[269,120]], detail: '沿原画山形建立起伏。山体之间的距离用于空间展示，不代表实际地理尺度。' },
  { name: '城门僧人', depth: 2.2, points: [[204,123],[234,124],[245,154],[243,184],[205,184]], detail: '敦煌研究院将城门前的两人解释为僧人。姿态和颜色来自原壁画，未添加姓名与对白。' },
  { name: '中景山道', depth: 3.0, points: [[0,198],[65,211],[116,192],[162,215],[211,201],[232,215],[204,231],[160,238],[105,230],[56,249],[0,270]], detail: '山道由画面层叠的山石形成，镜头沿它引导观察使者与城池。' },
  { name: '持旌节的随从', depth: 3.6, points: [[213,191],[278,188],[289,244],[216,253]], detail: '画中可见持旌节的随从。标签描述画面身份，不推定具体人物姓名。' },
  { name: '汉使一行', depth: 4.7, points: [[27,277],[96,275],[94,322],[127,308],[148,326],[163,371],[126,402],[37,410],[19,383]], detail: '画中汉使在山间前行。这一组人物保留原画姿态；当前以有厚度的图像浮雕呈现。' },
  { name: '前景山石', depth: 5.6, points: [[0,431],[62,412],[105,437],[153,419],[180,442],[226,427],[265,446],[265,467],[207,465],[168,483],[117,469],[58,490],[0,488]], detail: '前景山石提供遮挡与移动视差，颜色、轮廓和笔触沿用壁画。' },
]
const app=document.querySelector<HTMLDivElement>('#app')!
app.innerHTML=`<canvas aria-label="壁画空间自动叙事"></canvas><audio id="narrator" preload="auto" src="/mural-assets/narration/0.m4a"></audio><div id="veil"></div><header><a href="/yuezhi.html">History3D</a><span>莫高窟第323窟 · 初唐</span><button id="source">史料与壁画</button></header><section id="intro"><p class="eyebrow">走进壁画</p><h1>使者，山路与远方</h1><p>从张骞的拜别，走到画中的大夏。<br>镜头带你前行，故事沿途展开。</p><button id="start" class="primary" disabled>正在准备场景…</button><small id="load-status">正在读取原壁画与立体资产</small></section><div id="chapter-heading" hidden><span id="place"></span><h2 id="chapter-title"></h2></div><div id="subtitles" hidden><span id="chapter-number"></span><p id="narration"></p></div><aside hidden aria-label="史料与壁画说明"><button id="close" aria-label="关闭来源">×</button><h2>历史与画面，从哪里来？</h2><p>《史记》记载张骞出使、被拘留后继续西行，以及到达大夏。初唐壁画在这些历史记忆中，融入了金人、佛塔与僧人的佛教叙事。</p><p>本次三维空间沿用画中可见的人物类型、山石、城池与佛塔。人物面貌、建筑背面、山道距离与移动路线属于立体呈现的补全。</p><a href="https://zh.wikisource.org/wiki/史記/卷123#張騫" target="_blank" rel="noopener">《史记》卷123 · 大宛列传 ↗</a><a href="https://www.dha.ac.cn/info/1266/2524.htm" target="_blank" rel="noopener">敦煌研究院 · 壁画解读 ↗</a></aside><footer hidden><div class="playback"><button id="previous" aria-label="回看上一段">上一段</button><button id="pause">暂停</button><button id="next" aria-label="看下一段">下一段</button><button id="voice" aria-pressed="true">旁白：开</button></div><div class="timeline"><progress aria-label="故事进度" max="112" value="0"></progress><span id="clock">0:00 / 1:52</span></div></footer><section id="ending" hidden><p class="eyebrow">回到壁画</p><h2>远行留下历史，画家留下记忆。</h2><p>你刚走过的，是初唐画家笔下的张骞故事。</p><button id="replay" class="primary">再走一遍</button></section><div id="error" hidden role="alert"></div>`
const canvas=app.querySelector('canvas')!,renderer=new THREE.WebGLRenderer({canvas,antialias:true})
renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap
const scene=new THREE.Scene();scene.background=new THREE.Color('#171712')
const camera=new THREE.PerspectiveCamera(43,1,.1,150)
scene.add(new THREE.HemisphereLight('#fff0d2','#65766c',2.0));const sun=new THREE.DirectionalLight('#fff1d5',2.3);sun.position.set(-8,16,9);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);sun.shadow.camera.left=-24;sun.shadow.camera.right=24;sun.shadow.camera.top=28;sun.shadow.camera.bottom=-28;sun.shadow.bias=-.001;scene.add(sun)
const mural=new THREE.Group();scene.add(mural)
let cinema:CinemaWorld|null=null,relief:THREE.Mesh<THREE.PlaneGeometry>|null=null,original:Float32Array|null=null,depths:Float32Array|null=null,lastDepth=-1
let time=0,playing=false,started=false,currentChapter=-1,lastFrame=performance.now(),voice=true
const start=app.querySelector<HTMLButtonElement>('#start')!,pause=app.querySelector<HTMLButtonElement>('#pause')!,footer=app.querySelector<HTMLElement>('footer')!
const audio=app.querySelector<HTMLAudioElement>('#narrator')!
let audioChapter=-1
function playAudio(){audio.play().catch(error=>{if(error?.name==='AbortError')return;voice=false;app.querySelector('#voice')!.textContent='开启旁白';app.querySelector('#voice')!.setAttribute('aria-pressed','false')})}
function speak(text:string){const chapter=chapters.findIndex(c=>c.text===text);if(chapter===audioChapter)return;audio.pause();audioChapter=chapter;audio.src=`/mural-assets/narration/${chapter}.m4a`;audio.currentTime=0;if(voice&&playing)playAudio()}
function updatePause(){pause.disabled=time>=duration;pause.textContent=playing?'暂停':'继续';pause.setAttribute('aria-pressed',String(!playing))}
function begin(){audio.pause();audioChapter=-1;time=0;playing=true;started=true;currentChapter=-1;app.querySelector<HTMLElement>('#intro')!.hidden=true;app.querySelector<HTMLElement>('#ending')!.hidden=true;app.querySelector<HTMLElement>('#subtitles')!.hidden=false;app.querySelector<HTMLElement>('#chapter-heading')!.hidden=false;footer.hidden=false;updatePause();speak(chapters[0]!.text)}
start.onclick=begin;app.querySelector<HTMLButtonElement>('#replay')!.onclick=begin
pause.onclick=()=>{playing=!playing;if(playing&&voice)playAudio();else audio.pause();updatePause()}
function seek(index:number){audio.pause();audioChapter=-1;time=chapters[Math.max(0,Math.min(chapters.length-1,index))]!.start;currentChapter=-1;app.querySelector<HTMLElement>('#ending')!.hidden=true;app.querySelector<HTMLElement>('#subtitles')!.hidden=false;app.querySelector<HTMLElement>('#chapter-heading')!.hidden=false;playing=true;updatePause()}
app.querySelector<HTMLButtonElement>('#previous')!.onclick=()=>seek(currentChapter-1);app.querySelector<HTMLButtonElement>('#next')!.onclick=()=>seek(currentChapter+1)
app.querySelector<HTMLButtonElement>('#voice')!.onclick=()=>{voice=!voice;app.querySelector('#voice')!.textContent=voice?'旁白：开':'旁白：关';app.querySelector('#voice')!.setAttribute('aria-pressed',String(voice));audio.pause();if(voice&&started){audioChapter=-1;speak(chapters[Math.max(0,currentChapter)]!.text)}}
app.querySelector<HTMLButtonElement>('#source')!.onclick=()=>{app.querySelector<HTMLElement>('aside')!.hidden=false;if(started){playing=false;audio.pause();updatePause()}}
app.querySelector<HTMLButtonElement>('#close')!.onclick=()=>{app.querySelector<HTMLElement>('aside')!.hidden=true}
addEventListener('keydown',e=>{if(e.key==='Escape')app.querySelector<HTMLElement>('aside')!.hidden=true;if(e.code==='Space'&&started&&!(e.target as HTMLElement).closest('button,a')){e.preventDefault();pause.click()}})
addEventListener('pagehide',()=>{audio.pause()})
document.addEventListener('visibilitychange',()=>{if(document.hidden&&started){playing=false;audio.pause();updatePause()}})
function fail(message:string){app.querySelector<HTMLElement>('#error')!.hidden=false;app.querySelector('#error')!.textContent=message;start.textContent='场景暂不可用';app.querySelector('#load-status')!.textContent='请刷新重试，原有壁画页面仍可使用。'}
new THREE.TextureLoader().load(config.source,async texture=>{
 try{
  texture.colorSpace=THREE.SRGBColorSpace
  const mask=document.createElement('canvas');mask.width=1080;mask.height=895;const context=mask.getContext('2d')!;context.fillStyle='black';context.fillRect(0,0,1080,895)
  for(const layer of layers){context.beginPath();layer.points.forEach((p,i)=>i?context.lineTo(p[0]!,p[1]!):context.moveTo(p[0]!,p[1]!));context.closePath();const value=Math.round(layer.depth/6*255);context.fillStyle=`rgb(${value},${value},${value})`;context.fill()}
  const soft=document.createElement('canvas');soft.width=1080;soft.height=895;const ctx=soft.getContext('2d')!;ctx.filter='blur(12px)';ctx.drawImage(mask,0,0);const pixels=ctx.getImageData(0,0,1080,895).data
  const geometry=new THREE.PlaneGeometry(config.width,config.height,216,180),position=geometry.getAttribute('position');original=new Float32Array(position.array);depths=new Float32Array(position.count)
  for(let i=0;i<position.count;i++){const x=Math.min(1079,Math.max(0,Math.round((position.getX(i)/config.width+.5)*1080))),y=Math.min(894,Math.max(0,Math.round((.5-position.getY(i)/config.height)*895)));depths[i]=pixels[(y*1080+x)*4]!/255*2.6}
  relief=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({map:texture,side:THREE.DoubleSide}));mural.add(relief)
  cinema=await createCinemaWorld();scene.add(cinema.group);canvas.dataset.assets=String(cinema.assetCount);canvas.dataset.ready='true';start.disabled=false;start.textContent='开始这段远行';app.querySelector('#load-status')!.textContent='约两分钟 · 自动镜头与字幕 · 可随时暂停'
 }catch(error){fail(error instanceof Error?error.message:'场景读取失败')}
},undefined,()=>fail('壁画读取失败，请刷新重试。'))
function resize(){renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();config.cameraZ=Math.max(29,config.width/(2*Math.tan(THREE.MathUtils.degToRad(43/2))*camera.aspect)*1.08)}
addEventListener('resize',resize);resize()
const smooth=(t:number)=>THREE.MathUtils.smoothstep(t,0,1)
function muralShot(position:THREE.Vector3,target:THREE.Vector3){camera.position.copy(position);camera.lookAt(target)}
renderer.setAnimationLoop(()=>{
 const now=performance.now(),dt=Math.min((now-lastFrame)/1000,.08);lastFrame=now;if(playing)time=Math.min(duration,time+dt)
 const chapter=Math.max(0,chapters.findIndex(c=>time>=c.start&&time<c.end));const active=time>=duration?chapters.length-1:chapter
 if(started&&active!==currentChapter){currentChapter=active;const c=chapters[active]!;app.querySelector('#place')!.textContent=c.location;app.querySelector('#chapter-title')!.textContent=c.title;app.querySelector('#chapter-number')!.textContent=`${String(active+1).padStart(2,'0')} / ${String(chapters.length).padStart(2,'0')}`;app.querySelector('#narration')!.textContent=c.text;if(playing)speak(c.text)}
 const spatial=time>=48&&time<102
 app.classList.toggle('spatial',spatial);mural.visible=!spatial;if(cinema)cinema.group.visible=spatial
 scene.fog=spatial?new THREE.Fog('#c9bba0',28,80):null;scene.background=new THREE.Color(spatial?'#c9bba0':'#171712');camera.fov=spatial?48:43;camera.updateProjectionMatrix()
 let depth=0
 if(time<12){const t=smooth(time/12);muralShot(new THREE.Vector3(t*.4,t*.2,config.cameraZ-t*2),new THREE.Vector3(t*.4,t*.2,0))}
 else if(time<26){const t=smooth((time-12)/14);muralShot(new THREE.Vector3(6.1,4.7,18-t*2),new THREE.Vector3(6.1,4.7,0));depth=.15}
 else if(time<40){const t=smooth((time-26)/14);muralShot(new THREE.Vector3(-.7+t*.7,-6.3,20-t*2),new THREE.Vector3(-.7+t*.7,-6.3,0));depth=.15}
 else if(time<48){const t=smooth((time-40)/8);muralShot(new THREE.Vector3(-6.4,3.4,18-t*10),new THREE.Vector3(-6.4,3.4,0));depth=t}
 else if(time<87&&cinema){const t=smooth((time-48)/39);cinema.update(t);const view=cinema.camera(t);camera.position.copy(view.position);camera.lookAt(view.target);canvas.dataset.travel=t.toFixed(3)}
 else if(time<102&&cinema){cinema.update(1);const t=smooth((time-87)/15);camera.position.set(2.4-t*.8,2.9+t*1.4,-1-t*4);camera.lookAt(new THREE.Vector3(0,2.8+t*1.2,-18));canvas.dataset.travel='1.000'}
 else{const t=smooth((time-102)/10);muralShot(new THREE.Vector3(-6.4*(1-t),3.4*(1-t),14+(config.cameraZ-14)*t),new THREE.Vector3(-6.4*(1-t),3.4*(1-t),0));depth=1-t}
 // Conceal only the brief handoff from picture coordinates to a human-scale route.
 const veil=app.querySelector<HTMLElement>('#veil')!;veil.style.opacity=String(time>46&&time<50?1-Math.abs(time-48)/2:time>100&&time<104?1-Math.abs(time-102)/2:0)
 if(relief&&original&&depths&&Math.abs(depth-lastDepth)>.001){lastDepth=depth;const p=relief.geometry.getAttribute('position');for(let i=0;i<p.count;i++){const z=depths[i]!*depth,scale=(config.cameraZ-z)/config.cameraZ;p.setXYZ(i,original[i*3]!*scale,original[i*3+1]!*scale,z)}p.needsUpdate=true;relief.geometry.computeVertexNormals()}
 canvas.dataset.playing=String(playing);app.querySelector<HTMLProgressElement>('progress')!.value=time;app.querySelector('#clock')!.textContent=`${Math.floor(time/60)}:${String(Math.floor(time%60)).padStart(2,'0')} / 1:52`;canvas.dataset.time=time.toFixed(2);canvas.dataset.chapter=String(active);canvas.dataset.mode=spatial?'space':'mural'
 if(time>=duration&&playing){playing=false;updatePause();app.querySelector<HTMLElement>('#ending')!.hidden=false;app.querySelector<HTMLElement>('#subtitles')!.hidden=true;app.querySelector<HTMLElement>('#chapter-heading')!.hidden=true}
 renderer.render(scene,camera)
})
