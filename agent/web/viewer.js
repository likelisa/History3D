import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const $ = (id) => document.getElementById(id);
const runtime = { story: null, sceneData: null, manifest: null, quality: null, models: new Map(), cues: [], current: -1, sceneId: undefined, time: 0, playing: false, lastFrame: 0, total: 0, renderer: null, world: null, camera: null, actors: null, orbit: null, disposed: false, tracks: new Map(), narrationReady: false, voice: false, speed: 1, mediaCueId: null, mediaGeneration: 0, mediaReady: false, mediaEnded: false, playAttempt: 0, pendingPlay: null };
const PUBLIC_VOICE_ID = 'history3d-public-uncle-fu-r13';
const PUBLIC_REFERENCE_SHA = 'f47d4c2e50cdbc2dee165d7cd2415c5e667c9af68863127701344c20b6f73e37';
const PUBLIC_SOURCE_COMMIT = 'd7c2210da8c013e81a94bfc7b811a477c99fd506';
const kinds = { documented: '原文支持', inferred: '推断', illustrative: '艺术补充' };
const focusLabels = { identity: '器物整体', use: '用途', craft: '工艺', motif: '纹饰', history: '历史故事', condition: '保存状态' };
function artifactMode() { return runtime.story?.subjectType === 'artifact'; }
function node(tag, className, text) { const element = document.createElement(tag); if (className) element.className = className; if (text !== undefined) element.textContent = String(text); return element; }
function fail(message) { runtime.playing = false; stopAudio(); $('viewer-error').textContent = message; $('viewer-error').hidden = false; for (const id of ['play-button', 'voice-button', 'playback-speed', 'timeline', 'chapter-select', 'previous-cue', 'next-cue']) $(id).disabled = true; $('scene-error').textContent = message; $('scene-error').hidden = true; }
function localFile(path) {
  const base = new URL('./', location.href);
  const url = new URL(path, base);
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname) || url.search || url.hash || url.username || url.password) throw new Error('项目引用了包外资源，已停止加载。');
  return url;
}
async function json(path) {
  const response = await fetch(localFile(path), { cache: 'no-store', credentials: 'same-origin' });
  if (!response.ok) throw new Error(`项目文件未能载入：${path}`);
  return response.json();
}
function validateSubtitlePoints(text, points, seconds) {
  if (!Array.isArray(points) || !points.length) throw new Error('字幕时间戳缺失。');
  const length = Array.from(text).length; let previousTime = -1, previousEnd = 0;
  for (const point of points) {
    if (!point || !Number.isFinite(point.seconds) || point.seconds < 0 || point.seconds < previousTime || point.seconds > seconds || !Number.isInteger(point.textEnd) || point.textEnd <= previousEnd || point.textEnd > length) throw new Error('字幕时间戳与音轨或 Unicode 全文不匹配。');
    previousTime = point.seconds; previousEnd = point.textEnd;
  }
  if (previousEnd !== length) throw new Error('字幕时间戳未覆盖 Unicode 全文。');
}
function timedSubtitleText(text, seconds, points) {
  if (seconds < 0) return '';
  let end = 0; for (const point of points) { if (point.seconds > seconds) break; end = point.textEnd; }
  return Array.from(text).slice(0, end).join('');
}
function wavSeconds(buffer) {
  const view = new DataView(buffer), label = offset => String.fromCharCode(...new Uint8Array(buffer, offset, 4));
  if (buffer.byteLength < 44 || label(0) !== 'RIFF' || label(8) !== 'WAVE' || view.getUint32(4, true) + 8 !== buffer.byteLength) throw new Error('旁白 WAV 文件不完整。');
  let format = null, dataBytes = null;
  for (let offset = 12; offset + 8 <= buffer.byteLength;) {
    const length = view.getUint32(offset + 4, true), start = offset + 8;
    if (length > buffer.byteLength - start) throw new Error('旁白 WAV 数据段不完整。');
    if (label(offset) === 'fmt ') {
      if (length < 16) throw new Error('旁白 WAV 格式段不完整。');
      format = { type: view.getUint16(start, true), channels: view.getUint16(start + 2, true), rate: view.getUint32(start + 4, true), byteRate: view.getUint32(start + 8, true), align: view.getUint16(start + 12, true), bits: view.getUint16(start + 14, true) };
    }
    if (label(offset) === 'data') dataBytes = length;
    offset = start + length + length % 2;
  }
  if (!format || format.type !== 1 || format.channels !== 1 || format.bits !== 16 || format.align !== 2 || format.rate < 8000 || format.rate > 96000 || format.byteRate !== format.rate * 2 || !dataBytes || dataBytes % 2) throw new Error('旁白须为完整的单声道 PCM16 WAV。');
  return dataBytes / format.byteRate;
}
function narrationManifest() {
  const narration = runtime.story.narration;
  if (!narration || (narration.complete === false && narration.status === 'not_configured' && !narration.tracks && !narration.voiceId)) return null;
  if (narration.complete !== true || narration.formatVersion !== '1.0.0' || narration.voiceId !== PUBLIC_VOICE_ID || narration.referenceSha256 !== PUBLIC_REFERENCE_SHA || narration.sourceCommit !== PUBLIC_SOURCE_COMMIT || typeof narration.humanAudioReviewed !== 'boolean' || !Array.isArray(narration.tracks)) throw new Error('固定公开旁白清单不完整或音色身份不匹配。');
  const cues = runtime.story.chapters.flatMap(chapter => chapter.cues);
  if (narration.tracks.length !== cues.length || new Set(narration.tracks.map(track => track.id)).size !== narration.tracks.length) throw new Error('旁白音轨未逐句覆盖故事或存在重复 ID。');
  const tracks = new Map(narration.tracks.map(track => [track.id, track]));
  for (const cue of cues) {
    const track = tracks.get(cue.id);
    if (!track || !/^[a-z][a-z0-9-]{0,47}$/.test(track.id) || track.text !== cue.text || track.file !== `narration/${track.id}.wav` || !/^[a-f0-9]{64}$/i.test(track.sha256) || track.subtitleAudioSha256 !== track.sha256 || !Number.isInteger(track.bytes) || track.bytes < 44 || !Number.isFinite(track.seconds) || track.seconds < .3 || track.seconds > 180) throw new Error('旁白音轨、原文或字幕音轨指纹不匹配。');
    validateSubtitlePoints(cue.text, track.subtitlePoints, track.seconds);
  }
  return narration;
}
async function loadNarration() {
  const narration = narrationManifest(); if (!narration) return;
  if (!globalThis.crypto?.subtle) throw new Error('旁白文件指纹验证需要 localhost HTTP 服务。');
  const loaded = new Map();
  try {
    for (const track of narration.tracks) {
      $('scene-status').textContent = `校验真实旁白 ${loaded.size + 1} / ${narration.tracks.length}`;
      const response = await fetch(localFile(track.file), { cache: 'no-store', credentials: 'same-origin' });
      if (!response.ok) throw new Error(`旁白文件未能载入：${track.id}`);
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength !== track.bytes) throw new Error(`旁白文件字节数不匹配：${track.id}`);
      const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))].map(value => value.toString(16).padStart(2, '0')).join('');
      if (digest.toLowerCase() !== track.sha256.toLowerCase()) throw new Error(`旁白文件指纹不匹配：${track.id}`);
      const duration = wavSeconds(buffer);
      if (Math.abs(duration - track.seconds) > .025) throw new Error(`旁白实际 WAV 时长与清单不匹配：${track.id}`);
      loaded.set(track.id, { ...track, objectUrl: URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' })) });
    }
  } catch (error) { for (const track of loaded.values()) URL.revokeObjectURL(track.objectUrl); throw error; }
  runtime.tracks = loaded; runtime.narrationReady = true; runtime.voice = true;
}
function stopAudio() {
  runtime.playAttempt++; runtime.pendingPlay = null; $('narration-audio')?.pause();
}
function playbackLabel(restart = false) { return runtime.narrationReady ? restart ? '从头播放讲解' : '继续播放讲解' : restart ? '从头逐句阅读' : '继续逐句阅读'; }
function mediaClock() {
  const audio = $('narration-audio');
  return { cueId: runtime.mediaCueId, currentTime: audio.currentTime, duration: audio.duration, ready: runtime.mediaReady, ended: runtime.mediaEnded };
}
function advanceStoryClock(time, delta, cue) {
  const wallNext = Math.min(cue.end, time + Math.max(0, delta) * runtime.speed);
  if (!runtime.voice || !runtime.narrationReady) return wallNext;
  if (time < cue.audioStart) return Math.min(wallNext, cue.audioStart);
  const media = mediaClock();
  if (media.cueId !== cue.cue.id) return time >= cue.audioStart + cue.audioSeconds ? wallNext : time;
  if (!media.ready || !Number.isFinite(media.currentTime)) return Math.min(time, cue.end - .005);
  const position = Math.max(0, Math.min(cue.audioSeconds, media.currentTime));
  const spokenEnd = cue.audioStart + Math.min(cue.audioSeconds, Number.isFinite(media.duration) ? media.duration : cue.audioSeconds);
  if (!media.ended) return Math.min(cue.end - .005, cue.audioStart + position);
  if (time < spokenEnd) return Math.min(cue.end, spokenEnd);
  return wallNext;
}
function subtitleSeconds(current) {
  const local = runtime.time - current.audioStart, media = mediaClock();
  if (local < 0 || !runtime.voice || media.cueId !== current.cue.id || !media.ready || !Number.isFinite(media.currentTime)) return local;
  return runtime.mediaEnded ? current.audioSeconds : Math.max(0, Math.min(current.audioSeconds, media.currentTime));
}
function requestAudioPlay(current) {
  const audio = $('narration-audio');
  if (!runtime.playing || !runtime.voice || !runtime.narrationReady || !runtime.mediaReady || runtime.mediaEnded || runtime.time < current.audioStart || runtime.time >= current.audioStart + current.audioSeconds || !audio.paused || runtime.pendingPlay !== null) return;
  const generation = runtime.mediaGeneration, attempt = ++runtime.playAttempt, cueId = current.cue.id;
  runtime.pendingPlay = attempt; audio.playbackRate = runtime.speed;
  Promise.resolve().then(() => {
    if (generation !== runtime.mediaGeneration || attempt !== runtime.playAttempt || !runtime.playing || !runtime.voice) return;
    return audio.play();
  }).then(() => { if (attempt === runtime.playAttempt) runtime.pendingPlay = null; }).catch(() => {
    if (generation !== runtime.mediaGeneration || attempt !== runtime.playAttempt || runtime.mediaCueId !== cueId || !runtime.playing || !runtime.voice || runtime.disposed) return;
    pause(); $('viewer-error').textContent = '浏览器未能开始旁白播放。点击“继续播放讲解”重试；当前句仍保留。'; $('viewer-error').hidden = false;
  });
}
function configureAudio(current, force = false) {
  if (!runtime.narrationReady) return;
  const audio = $('narration-audio'), track = runtime.tracks.get(current.cue.id);
  if (!track) throw new Error('当前句缺少已校验的旁白。');
  if (force || runtime.mediaCueId !== current.cue.id) {
    stopAudio(); const generation = ++runtime.mediaGeneration;
    const local = Math.max(0, Math.min(current.audioSeconds, runtime.time - current.audioStart));
    runtime.mediaCueId = current.cue.id; runtime.mediaReady = false; runtime.mediaEnded = runtime.time >= current.audioStart + current.audioSeconds;
    audio.src = track.objectUrl; audio.playbackRate = runtime.speed;
    const ready = () => {
      if (generation !== runtime.mediaGeneration || runtime.disposed) return;
      if (audio.currentSrc && audio.currentSrc !== track.objectUrl) return;
      if (!Number.isFinite(audio.duration) || Math.abs(audio.duration - track.seconds) > .05) return fail('浏览器解码旁白的实际时长与已校验音轨不匹配。');
      runtime.mediaReady = true;
      try { audio.currentTime = local; } catch { return fail('浏览器未能定位当前旁白。'); }
      if (!runtime.mediaEnded) requestAudioPlay(current);
    };
    audio.onloadedmetadata = ready;
    audio.onended = () => { if (generation === runtime.mediaGeneration && runtime.mediaCueId === current.cue.id && (!audio.currentSrc || audio.currentSrc === track.objectUrl) && audio.ended) runtime.mediaEnded = true; };
    audio.onerror = () => { if (generation === runtime.mediaGeneration) fail('浏览器未能播放已校验的旁白音轨，已停止讲解。'); };
    audio.load(); if (audio.readyState >= 1) ready();
  }
  if (!runtime.playing || !runtime.voice || runtime.time < current.audioStart || runtime.mediaEnded) audio.pause();
  else requestAudioPlay(current);
}
function inspectGlb(buffer) {
  if (buffer.byteLength < 20) throw new Error('GLB 文件不完整。');
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== buffer.byteLength || view.getUint32(16, true) !== 0x4e4f534a) throw new Error('GLB 头或文件长度不匹配。');
  const jsonBytes = view.getUint32(12, true);
  if (jsonBytes > buffer.byteLength - 20) throw new Error('GLB JSON 数据不完整。');
  const content = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, jsonBytes)).replace(/\u0000+$/, ''));
  if ((content.buffers || []).some(item => item.uri && !/^data:application\/octet-stream;base64,/.test(item.uri))) throw new Error('GLB 包含外部 buffer，不能作为独立网页资产。');
  if ((content.images || []).some(item => item.uri && !/^data:image\/(?:png|jpeg|webp);base64,/.test(item.uri))) throw new Error('GLB 包含外部纹理，已拒绝加载。');
}
async function loadAsset(item) {
  if (!/^[a-z][a-z0-9-]{0,47}$/.test(item.id) || !/^[a-f0-9]{64}$/i.test(item.sha256) || !Number.isInteger(item.bytes) || item.bytes <= 0) throw new Error('资产清单缺少有效的 ID、文件指纹或字节数。');
  if (item.url !== `./assets/${item.id}.glb`) throw new Error('资产地址与项目清单不一致。');
  const response = await fetch(localFile(item.url), { cache: 'no-store', credentials: 'same-origin' });
  if (!response.ok) throw new Error(`真实 GLB 未能载入：${item.id}`);
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength !== item.bytes) throw new Error(`GLB 字节数不匹配：${item.id}`);
  if (!globalThis.crypto?.subtle) throw new Error('请通过本地 localhost HTTP 服务打开项目，以验证 GLB 文件指纹。');
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))].map(value => value.toString(16).padStart(2, '0')).join('');
  if (digest.toLowerCase() !== item.sha256.toLowerCase()) throw new Error(`GLB 文件指纹不匹配：${item.id}`);
  inspectGlb(buffer);
  const manager = new THREE.LoadingManager();
  let resourceFailed = false;
  manager.onError = () => { resourceFailed = true; };
  const loaded = await new GLTFLoader(manager).parseAsync(buffer, new URL('./', location.href).href);
  // GLTFLoader can return a scene after replacing a failed texture with null.
  // A verified file with unreadable embedded resources is not a loaded asset.
  if (resourceFailed) throw new Error(`真实 GLB 的内嵌纹理未能载入：${item.id}。请检查资源策略与浏览器图像支持。`);
  const scene = loaded.scene;
  const bounds = new THREE.Box3().setFromObject(scene);
  const height = bounds.max.y - bounds.min.y;
  if (!Number.isFinite(height) || height <= 0.00001) throw new Error(`GLB 没有可用的模型高度：${item.id}`);
  return { scene, item, height };
}
function buildRenderer() {
  const renderer = new THREE.WebGLRenderer({ canvas: $('scene-canvas'), antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
  const world = new THREE.Scene(); world.background = new THREE.Color('#e4e6dc');
  world.add(new THREE.HemisphereLight(0xfffae6, 0x72785d, 2));
  const sunlight = new THREE.DirectionalLight(0xfff5dd, 3); sunlight.position.set(4, 7, 5); world.add(sunlight);
  const fill = new THREE.DirectionalLight(0xd6e2ff, 1.2); fill.position.set(-4, 3, -3); world.add(fill);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(70, 70), new THREE.MeshStandardMaterial({ color: '#cbd0bd', roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -.002; world.add(ground);
  const actors = new THREE.Group(); world.add(actors);
  runtime.renderer = renderer; runtime.world = world; runtime.actors = actors; runtime.camera = new THREE.PerspectiveCamera(45, 1, .01, 400);
  const resize = () => { const width = $('scene-window').clientWidth; const height = $('scene-window').clientHeight; renderer.setSize(width, height, false); runtime.camera.aspect = width / Math.max(height, 1); runtime.camera.updateProjectionMatrix(); updateAnchor(); };
  new ResizeObserver(resize).observe($('scene-window')); resize();
  setupCameraControls();
}
function normalModel(assetId) {
  const loaded = runtime.models.get(assetId);
  const definition = runtime.sceneData.assets.find(asset => asset.id === assetId);
  if (!loaded || !definition || !(definition.heightM > 0)) throw new Error(`场景引用了未载入的资产：${assetId}`);
  const model = loaded.scene.clone(true);
  const scaleGroup = new THREE.Group(); scaleGroup.add(model);
  const factor = definition.normalization?.runtimeScaleToHeight ? definition.heightM / loaded.height : 1;
  scaleGroup.scale.setScalar(factor); scaleGroup.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(scaleGroup); const center = bounds.getCenter(new THREE.Vector3());
  const groundGroup = new THREE.Group(); groundGroup.add(scaleGroup);
  if (definition.normalization?.centerXZ) scaleGroup.position.set(-center.x, scaleGroup.position.y, -center.z);
  if (definition.normalization?.groundAtYZero) scaleGroup.position.y = -bounds.min.y;
  groundGroup.rotation.y = definition.frontYawRadians || 0;
  return groundGroup;
}
function applyOrbit() {
  if (!runtime.orbit) return;
  const { target, radius, yaw, pitch } = runtime.orbit;
  runtime.camera.position.set(target.x + radius * Math.sin(yaw) * Math.cos(pitch), target.y + radius * Math.sin(pitch), target.z + radius * Math.cos(yaw) * Math.cos(pitch));
  runtime.camera.lookAt(target);
}
function resetCamera() {
  const scene = runtime.sceneData.scenes.find(item => item.id === runtime.sceneId);
  if (artifactMode() && primaryActor()) { framePrimaryAsset(scene); return; }
  const bounds = new THREE.Box3().setFromObject(runtime.actors);
  const target = bounds.isEmpty() ? new THREE.Vector3(0, .8, 0) : bounds.getCenter(new THREE.Vector3());
  const position = scene ? new THREE.Vector3(...scene.camera) : new THREE.Vector3(3, 2, 6);
  const diagonal = bounds.isEmpty() ? 2 : bounds.getSize(new THREE.Vector3()).length();
  const minRadius = Math.max(.005, diagonal * .08), maxRadius = Math.max(10, diagonal * 50);
  const delta = position.sub(target); const radius = Math.max(minRadius, Math.min(maxRadius, delta.length()));
  runtime.orbit = { target, radius, minRadius, maxRadius, yaw: Math.atan2(delta.x, delta.z), pitch: Math.max(-.1, Math.min(1.3, Math.asin(Math.max(-1, Math.min(1, delta.y / Math.max(delta.length(), .00001)))))) }; applyOrbit();
}
function primaryActor() {
  const id = runtime.story?.primaryAssetId;
  return id ? runtime.actors?.children.find(item => item.userData.assetId === id) : null;
}
function focusPrimaryAsset() {
  framePrimaryAsset(null);
}
function framePrimaryAsset(scene) {
  const actor = primaryActor(); if (!actor) return;
  const bounds = new THREE.Box3().setFromObject(actor); if (bounds.isEmpty()) return;
  const center = bounds.getCenter(new THREE.Vector3()), size = bounds.getSize(new THREE.Vector3());
  const target = center.clone(), framing = scene?.cameraFraming;
  if (framing?.region === 'upper') target.y = bounds.min.y + size.y * .78;
  if (framing?.region === 'lower') target.y = bounds.min.y + size.y * .2;
  const diagonal = size.length();
  const minRadius = Math.max(.005, diagonal * .08), maxRadius = Math.max(10, diagonal * 50);
  const direction = scene ? new THREE.Vector3(...scene.camera).sub(center).normalize() : new THREE.Vector3(Math.sin(runtime.orbit?.yaw || 0), .15, Math.cos(runtime.orbit?.yaw || 0)).normalize();
  if (direction.lengthSq() < .1) direction.set(0, .15, 1).normalize();
  const yaw = Math.atan2(direction.x, direction.z), pitch = Math.max(-.1, Math.min(1.3, Math.asin(direction.y)));
  const towardCamera = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const up = new THREE.Vector3(-Math.sin(yaw) * Math.sin(pitch), Math.cos(pitch), -Math.cos(yaw) * Math.sin(pitch));
  const tanV = Math.tan(runtime.camera.fov * Math.PI / 360), tanH = tanV * Math.max(.1, runtime.camera.aspect);
  let fitRadius = minRadius;
  for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
    const offset = new THREE.Vector3(x, y, z).sub(center), depth = offset.dot(towardCamera);
    fitRadius = Math.max(fitRadius, Math.abs(offset.dot(right)) / tanH + depth, Math.abs(offset.dot(up)) / tanV + depth);
  }
  // Explicit region framing selects a volume, never an inferred 3D motif coordinate.
  const firstScene = runtime.sceneData.scenes.find(item => item.placements?.some(placement => placement.assetId === runtime.story.primaryAssetId));
  const firstDistance = firstScene ? new THREE.Vector3(...firstScene.camera).distanceTo(center) : 0;
  const currentDistance = scene ? new THREE.Vector3(...scene.camera).distanceTo(center) : 0;
  const magnification = framing?.magnification || (firstDistance && currentDistance ? Math.max(1, Math.min(1.8, firstDistance / currentDistance)) : 1);
  runtime.orbit = { target, radius: Math.max(minRadius, fitRadius * 1.16 / magnification), minRadius, maxRadius, yaw, pitch }; applyOrbit();
}
function setupCameraControls() {
  const canvas = $('scene-canvas'); let pointer = null;
  canvas.addEventListener('pointerdown', event => { pointer = { id: event.pointerId, x: event.clientX, y: event.clientY }; canvas.setPointerCapture(event.pointerId); });
  canvas.addEventListener('pointermove', event => {
    if (!pointer || pointer.id !== event.pointerId || !runtime.orbit) return;
    runtime.orbit.yaw -= (event.clientX - pointer.x) * .008; runtime.orbit.pitch = Math.max(-.1, Math.min(1.3, runtime.orbit.pitch + (event.clientY - pointer.y) * .006));
    pointer.x = event.clientX; pointer.y = event.clientY; applyOrbit();
  });
  const release = () => { pointer = null; }; canvas.addEventListener('pointerup', release); canvas.addEventListener('pointercancel', release); canvas.addEventListener('lostpointercapture', release);
  canvas.addEventListener('wheel', event => { if (!runtime.orbit) return; event.preventDefault(); runtime.orbit.radius = Math.max(runtime.orbit.minRadius, Math.min(runtime.orbit.maxRadius, runtime.orbit.radius * Math.exp(event.deltaY * .001))); applyOrbit(); }, { passive: false });
  $('reset-view').addEventListener('click', resetCamera);
  $('focus-primary').addEventListener('click', focusPrimaryAsset);
}
function showScene(id) {
  if (runtime.sceneId === id) return;
  runtime.sceneId = id; runtime.actors.clear();
  const scene = runtime.sceneData.scenes.find(item => item.id === id);
  if (scene) {
    for (const placement of scene.placements) {
      const model = normalModel(placement.assetId); const group = new THREE.Group(); group.add(model);
      group.userData.assetId = placement.assetId;
      group.position.set(...placement.position); group.rotation.y = placement.heading; runtime.actors.add(group);
    }
    runtime.actors.updateMatrixWorld(true);
    $('scene-status').textContent = `${scene.title} · ${scene.placements.length} 项真实 GLB · 静态布景预览`;
  } else $('scene-status').textContent = '本句未配置 3D 场景，请阅读讲解与原图关系';
  $('focus-primary').hidden = !artifactMode(); $('focus-primary').disabled = !primaryActor();
  resetCamera();
}
function cueAnchor(cue) {
  const anchor = cue?.imageRelation === 'depicted' ? cue.imageAnchor ?? cue.muralAnchor : null;
  return anchor && Number.isFinite(anchor.x) && Number.isFinite(anchor.y) && anchor.x >= 0 && anchor.x <= 1 && anchor.y >= 0 && anchor.y <= 1 ? anchor : null;
}
function placeAnchor(wrapId, imageId, markerId, anchor) {
  const image = $(imageId), marker = $(markerId);
  marker.hidden = !anchor || !image.complete || !image.naturalWidth;
  if (marker.hidden) return;
  const wrap = $(wrapId).getBoundingClientRect(), rectangle = image.getBoundingClientRect();
  if (!rectangle.width || !rectangle.height) { marker.hidden = true; return; }
  marker.style.left = `${rectangle.left - wrap.left + rectangle.width * anchor.x}px`;
  marker.style.top = `${rectangle.top - wrap.top + rectangle.height * anchor.y}px`;
  marker.setAttribute('aria-label', anchor.label ? `本句原图细节：${anchor.label}` : '本句在原图中的标注位置');
}
function updateAnchor() {
  const anchor = cueAnchor(runtime.cues[runtime.current]?.cue);
  placeAnchor('mural-image-wrap', 'mural-image', 'mural-anchor', anchor);
  if ($('image-dialog').open) placeAnchor('image-detail-wrap', 'image-detail', 'image-detail-anchor', anchor);
}
function renderImage(cue) {
  const anchor = cueAnchor(cue), subject = artifactMode() ? '文物原图' : '壁画原图';
  const relation = cue.imageRelation;
  $('mural-caption').textContent = relation === 'depicted' ? anchor ? `本句${anchor.label ? `「${anchor.label}」` : '细节'}已在${subject}标注；标记由模型计划提出，仍需人工核实。` : `计划将本句标为${subject}可见，未标注具体位置；请人工对照全图。` : relation === 'not-depicted' ? `本句内容未在${subject}展示；保留原图供整体参照，不补造可见细节点。` : `${subject}仅作背景参照；本句没有直接对应的细节位置标注。`;
  $('image-detail-caption').textContent = `${cue.text} ${$('mural-caption').textContent} 原图未经修改；标记仅为讲解叠层。`;
  updateAnchor();
}
function setupImageInspection() {
  $('inspect-image').disabled = false;
  $('inspect-image').addEventListener('click', () => {
    $('image-detail').src = $('mural-image').src;
    $('image-dialog-title').textContent = artifactMode() ? '文物原图 · 当前细节对照' : '壁画原图 · 当前细节对照';
    $('image-detail').alt = artifactMode() ? '未经修改的文物原图放大对照' : '未经修改的壁画原图放大对照';
    $('image-dialog').showModal(); updateAnchor();
  });
  $('close-image').addEventListener('click', () => $('image-dialog').close());
  $('image-detail').addEventListener('load', updateAnchor);
  $('mural-image').addEventListener('load', updateAnchor);
  new ResizeObserver(updateAnchor).observe($('mural-image-wrap'));
  new ResizeObserver(updateAnchor).observe($('image-detail-wrap'));
}
function formatTime(seconds) { const value = Math.max(0, Math.floor(seconds)); return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`; }
function showMoment(time, manual = false, rebuildAudio = false) {
  runtime.time = Math.max(0, Math.min(runtime.total, time));
  const index = runtime.cues.findIndex((item, cueIndex) => runtime.time < item.end || cueIndex === runtime.cues.length - 1);
  const current = runtime.cues[index]; if (!current) return;
  const changed = runtime.current !== index;
  runtime.current = index;
  if (changed || rebuildAudio) configureAudio(current, rebuildAudio);
  if (changed) {
    showScene(current.cue.sceneId); renderImage(current.cue);
    $('chapter-title').textContent = `${current.chapter.title} · 第 ${index + 1} / ${runtime.cues.length} 句`;
    $('cue-kind').textContent = kinds[current.cue.kind] || current.cue.kind;
    $('cue-kind').className = `tag ${current.cue.kind === 'documented' ? 'success' : 'warning'}`;
    $('chapter-select').value = current.chapter.id;
    for (const item of document.querySelectorAll('.viewer-story .cue-card')) item.classList.toggle('current', Number(item.dataset.index) === index);
  }
  const inTail = runtime.time >= current.audioStart + current.audioSeconds && (!runtime.voice || runtime.mediaEnded);
  if (runtime.narrationReady) {
    const beforePlayback = !runtime.playing && runtime.time === current.start;
    $('cue-text').textContent = beforePlayback || inTail ? current.cue.text : timedSubtitleText(current.cue.text, subtitleSeconds(current), runtime.tracks.get(current.cue.id).subtitlePoints);
    $('cue-phase').textContent = runtime.voice ? `固定公开旁白 · ${runtime.speed} 倍速` : '旁白已关闭 · 跟随字幕阅读';
    configureAudio(current);
  } else {
    $('cue-text').textContent = current.cue.text;
    $('cue-phase').textContent = '逐句阅读模式 · 本包尚无旁白音轨，计时不代表语音已播放';
  }
  $('timeline').value = String(runtime.time); $('time-display').textContent = `${formatTime(runtime.time)} / ${formatTime(runtime.total)}`;
  $('previous-cue').disabled = index === 0; $('next-cue').disabled = index === runtime.cues.length - 1;
  if (runtime.time >= runtime.total) { runtime.playing = false; stopAudio(); $('play-button').textContent = playbackLabel(true); }
}
function pause() {
  const current = runtime.cues[runtime.current];
  if (runtime.playing && current) runtime.time = advanceStoryClock(runtime.time, 0, current);
  runtime.playing = false; stopAudio(); $('play-button').textContent = playbackLabel(runtime.time >= runtime.total); showMoment(runtime.time, true);
}
function seekTime(time) { runtime.playing = false; stopAudio(); $('play-button').textContent = playbackLabel(); showMoment(time, true, true); }
function seek(index) { if (runtime.cues[index]) seekTime(runtime.cues[index].start); }
function buildTimeline() {
  let start = 0;
  for (const chapter of runtime.story.chapters) {
    const option = node('option', '', chapter.title); option.value = chapter.id; $('chapter-select').append(option);
    for (const cue of chapter.cues) {
      // Scene changes accompany the story; no artificial observation barrier.
      const visualSeconds = 0;
      const audioSeconds = runtime.narrationReady ? runtime.tracks.get(cue.id).seconds : Math.max(8, Array.from(cue.text).length / 3.5);
      const readingSeconds = 0;
      runtime.cues.push({ cue, chapter, start, audioStart: start + visualSeconds, audioSeconds, end: start + visualSeconds + audioSeconds + readingSeconds, visualSeconds }); start += visualSeconds + audioSeconds + readingSeconds;
    }
  }
  runtime.total = start; $('timeline').max = String(start); $('story-count').textContent = `${runtime.story.chapters.length} 章 · ${runtime.cues.length} 句`;
}
function sourceLink(url) { try { const parsed = new URL(url); return ['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password ? parsed.href : null; } catch { return null; } }
function renderStory() {
  const sources = new Map(runtime.story.sources.map(source => [source.id, source]));
  let index = 0;
  for (const chapter of runtime.story.chapters) {
    const section = node('section', 'chapter'); section.append(node('h3', 'chapter-heading', chapter.title));
    for (const cue of chapter.cues) {
      const cueIndex = index++; const card = node('article', 'cue-card'); card.dataset.index = String(cueIndex);
      const body = node('div'); const button = node('button', 'cue-text', cue.text); button.type = 'button'; button.addEventListener('click', () => seek(cueIndex)); body.append(button);
      const meta = node('div', 'cue-meta'); meta.append(node('span', `tag ${cue.kind === 'documented' ? 'success' : 'warning'}`, kinds[cue.kind] || cue.kind), node('span', 'tag', (cue.sourceIds || []).join('、') || '无原文引用'));
      if (focusLabels[cue.focus]) meta.append(node('span', 'tag', focusLabels[cue.focus]));
      if (cueAnchor(cue)?.label) meta.append(node('span', 'tag', `原图细节：${cueAnchor(cue).label}`));
      body.append(meta);
      const details = node('details'); details.append(node('summary', '', '查看依据与原文'));
      const list = node('ul', 'evidence-list');
      for (const evidence of cue.evidence || []) {
        const source = sources.get(evidence.sourceId); const row = node('li'); row.append(node('strong', '', source?.title || evidence.sourceId), node('span', '', evidence.quote));
        const href = source && sourceLink(source.url);
        if (href) { const link = node('a', 'source-link', '回查原文'); link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer'; row.append(node('br'), link); }
        list.append(row);
      }
      if (!(cue.evidence || []).length) list.append(node('li', '', '本句属于推断或艺术补充，不表示独立核实的史实。'));
      details.append(list); body.append(details); card.append(node('span', 'cue-number', String(cueIndex + 1).padStart(2, '0')), body); section.append(card);
    }
    $('full-story').append(section);
  }
}
function renderAssets() {
  for (const item of runtime.manifest.assets) {
    const primary = item.id === runtime.story.primaryAssetId;
    const card = node('article', 'asset-card'); card.append(node('h4', '', primary ? runtime.story.subjectMetadata?.name || item.id : item.id), node('span', 'tag success', 'GLB 字节与 SHA 已校验'));
    if (primary) card.append(node('span', 'tag warning', '文物主资产 · 图生 3D · 艺术重建'));
    const details = node('dl');
    for (const [label, value] of [['提供商', runtime.manifest.provider], ['Tripo task', item.taskId], ['文件大小', `${item.bytes.toLocaleString()} bytes`], ['展示高度', `${item.heightM} m（展示比例，非实测）`], ['前轴', '未经人工前轴审核']]) details.append(node('dt', '', label), node('dd', '', value));
    card.append(details);
    const hash = node('details'); hash.append(node('summary', '', '文件与请求指纹'), node('code', 'hash', `GLB ${item.sha256}`), node('code', 'hash', `request ${item.requestSha256}`)); card.append(hash); $('viewer-asset-list').append(card);
  }
  $('loaded-count').textContent = `${runtime.models.size} 项实际 GLB`;
}
function renderQuality() {
  const keys = [['structuralPassed', '结构检查'], ['visualReviewed', '视觉审核'], ['historicalVerified', '独立史料核实'], ['recordingVerified', '完整录屏'], ['zipVerified', '独立解包']];
  const actual = { structuralPassed: (runtime.quality.coveredChecks || []).some(item => item.id === 'json-contract' && item.result === 'pass'), visualReviewed: runtime.quality.visualReview?.approved === true, historicalVerified: false, recordingVerified: false, zipVerified: false };
  for (const [key, label] of keys) $('quality-flags').append(node('span', `quality-item ${actual[key] ? 'passed' : ''}`, `${actual[key] ? '✓' : '○'} ${label}${actual[key] ? '已记录通过' : '待完成'}`));
  const narration = runtime.narrationReady ? `固定公开旁白已逐句通过字节、SHA、WAV 时长与字幕全文检查，播放使用真实媒体时钟。${runtime.story.narration.humanAudioReviewed ? '清单记录了人工听音审核；实际听感仍可逐句复核。' : '人工听音尚未验收，文件检查不能代替听音判断。'}` : '旁白尚未配置，本页提供有阅读时间的逐句播放。';
  const animation = runtime.sceneData.animation?.complete === true ? '动作标记为已配置，但当前模板仅提供静态布景；不得作为人物动作验收。' : '人物动作尚未配置，GLB 以静态布景显示。';
  const boundary = artifactMode() ? '文物 3D 是由原图生成的艺术重建。原图未见的背面、内部与补全纹饰属于艺术补全，不能当作考古事实。展示高度用于场景比例，不能代替实测尺寸。原图细节点可放大对照，尚未自动绑定 3D 纹饰位置。' : '资产按展示高度、落地与居中归一；前轴、手部、姿态与考古形制仍须人工审核。';
  $('viewer-limits').textContent = `${narration} ${animation} ${boundary}`;
}
function frame(now) {
  if (runtime.disposed) return;
  if (runtime.playing) {
    const delta = runtime.lastFrame ? Math.min((now - runtime.lastFrame) / 1000, .25) : 0;
    const current = runtime.cues[runtime.current];
    if (current) showMoment(advanceStoryClock(runtime.time, delta, current));
  }
  runtime.lastFrame = now; runtime.renderer?.render(runtime.world, runtime.camera); requestAnimationFrame(frame);
}
async function start() {
  if (location.protocol === 'file:') throw new Error('请用本地 HTTP 服务打开这个网页工程，不能直接双击 HTML。');
  const [story, sceneData, manifest, quality] = await Promise.all(['./story.json', './scene.json', './asset-manifest.json', './quality-report.json'].map(json));
  if (![story, sceneData, manifest].every(item => item.formatVersion === '1.0.0') || !Array.isArray(story.chapters) || !Array.isArray(sceneData.scenes) || !Array.isArray(sceneData.assets) || !Array.isArray(manifest.assets) || !manifest.assets.length) throw new Error('网页工程的数据版本或资产清单不完整。');
  if (new Set(manifest.assets.map(item => item.id)).size !== manifest.assets.length) throw new Error('资产清单存在重复 ID。');
  runtime.story = story; runtime.sceneData = sceneData; runtime.manifest = manifest; runtime.quality = quality;
  renderStory();
  await loadNarration();
  $('story-title').textContent = story.title; $('story-summary').textContent = story.summary; document.title = `${story.title} · ${artifactMode() ? '文物' : '壁画'}故事预览`;
  $('subject-heading').textContent = `${artifactMode() ? '文物' : '壁画'}讲解 · 人工预览`;
  $('image-heading').textContent = `${artifactMode() ? '文物' : '壁画'}原图`;
  $('mural-image').alt = `作为叙事参照的${artifactMode() ? '文物' : '壁画'}原图`;
  const metadata = ['name', 'period', 'material', 'dimensions', 'collection'].map(key => story.subjectMetadata?.[key]).filter(Boolean);
  $('subject-information').textContent = metadata.length ? `${metadata.join(' · ')}（用户提供，未独立核实）` : '';
  $('subject-information').hidden = !metadata.length;
  $('mural-image').src = localFile(story.image).href; await $('mural-image').decode();
  for (const [index, item] of manifest.assets.entries()) {
    $('scene-status').textContent = `校验并载入真实 GLB ${index + 1} / ${manifest.assets.length}`;
    runtime.models.set(item.id, await loadAsset(item));
  }
  buildRenderer(); buildTimeline(); setupImageInspection();
  if (!runtime.cues.length) throw new Error('网页工程没有可阅读的故事句子。');
  renderAssets(); renderQuality(); showMoment(0, true);
  for (const id of ['play-button', 'timeline', 'chapter-select', 'playback-speed']) $(id).disabled = false;
  $('playback-speed').value = '1';
  $('voice-button').disabled = !runtime.narrationReady;
  $('voice-button').textContent = runtime.narrationReady ? '旁白：开' : '未配置旁白'; $('voice-button').setAttribute('aria-pressed', String(runtime.voice));
  $('play-button').textContent = runtime.narrationReady ? '开始播放讲解' : '开始逐句阅读';
  $('play-button').addEventListener('click', () => { if (runtime.playing) return pause(); if (runtime.time >= runtime.total) seekTime(0); runtime.playing = true; runtime.lastFrame = performance.now(); $('play-button').textContent = runtime.narrationReady ? '暂停讲解' : '暂停阅读'; $('viewer-error').hidden = true; showMoment(runtime.time); });
  $('previous-cue').addEventListener('click', () => seek(Math.max(0, runtime.current - 1)));
  $('next-cue').addEventListener('click', () => seek(Math.min(runtime.cues.length - 1, runtime.current + 1)));
  $('timeline').addEventListener('input', () => seekTime(Number($('timeline').value)));
  $('playback-speed').addEventListener('change', () => {
    const speed = Number($('playback-speed').value); if (![.75, 1, 1.25, 1.5, 2].includes(speed)) return;
    runtime.speed = speed; $('narration-audio').playbackRate = speed; showMoment(runtime.time, true);
  });
  $('voice-button').addEventListener('click', () => {
    if (!runtime.narrationReady) return;
    runtime.voice = !runtime.voice; stopAudio();
    $('voice-button').textContent = runtime.voice ? '旁白：开' : '旁白：关'; $('voice-button').setAttribute('aria-pressed', String(runtime.voice));
    showMoment(runtime.time, true, true);
  });
  $('chapter-select').addEventListener('change', () => seek(runtime.cues.findIndex(item => item.chapter.id === $('chapter-select').value)));
  document.addEventListener('visibilitychange', () => { if (document.hidden && runtime.playing) pause(); });
  window.addEventListener('resize', updateAnchor); requestAnimationFrame(frame);
}
window.addEventListener('pagehide', () => { runtime.disposed = true; stopAudio(); runtime.mediaGeneration++; for (const track of runtime.tracks.values()) URL.revokeObjectURL(track.objectUrl); runtime.renderer?.dispose(); });
start().catch(error => fail(error.message || '网页工程未通过加载检查。'));
