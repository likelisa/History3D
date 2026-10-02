import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { readFileSync } from 'node:fs'
import { stepTarget, solveLeg, bindWalkRig, passingGlance } from '../viewer/src/mural/walking.ts'
import { greetingYaw } from '../viewer/src/mural/cinema-world.ts'
import {capturedStride,capturedWalkSource,capturedWalk} from '../viewer/src/mural/captured-walk.ts'

function realModel(path: string, height: number) {
  const bytes = readFileSync(path), jsonLength = bytes.readUInt32LE(12)
  const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8'))
  const binaryOffset = 28 + jsonLength
  const nodes = gltf.nodes.map((node: any) => {
    const o = new THREE.Group()
    if (node.translation) o.position.fromArray(node.translation)
    if (node.rotation) o.quaternion.fromArray(node.rotation)
    if (node.scale) o.scale.fromArray(node.scale)
    if (node.mesh !== undefined) for (const primitive of gltf.meshes[node.mesh].primitives) {
      const geometry = new THREE.BufferGeometry()
      for (const [source, target, components] of [['POSITION', 'position', 3], ['NORMAL', 'normal', 3], ['TEXCOORD_0', 'uv', 2]] as const) {
        const a = gltf.accessors[primitive.attributes[source]], v = gltf.bufferViews[a.bufferView]
        const values = new Float32Array(a.count * components)
        for (let i = 0; i < values.length; i++) values[i] = bytes.readFloatLE(binaryOffset + (v.byteOffset ?? 0) + (a.byteOffset ?? 0) + i * 4)
        geometry.setAttribute(target, new THREE.Float32BufferAttribute(values, components))
      }
      if (primitive.indices !== undefined) {
        const a = gltf.accessors[primitive.indices], v = gltf.bufferViews[a.bufferView], stride = a.componentType === 5123 ? 2 : 4
        const values = Array.from({ length: a.count }, (_, i) => stride === 2 ? bytes.readUInt16LE(binaryOffset + (v.byteOffset ?? 0) + (a.byteOffset ?? 0) + i * stride) : bytes.readUInt32LE(binaryOffset + (v.byteOffset ?? 0) + (a.byteOffset ?? 0) + i * stride))
        geometry.setIndex(values)
      }
      o.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial()))
    }
    return o
  })
  gltf.nodes.forEach((node: any, i: number) => { for (const child of node.children ?? []) nodes[i].add(nodes[child]) })
  const scene = new THREE.Group()
  for (const i of gltf.scenes[gltf.scene ?? 0].nodes) scene.add(nodes[i])
  const box = new THREE.Box3().setFromObject(scene), scale = height / (box.max.y - box.min.y)
  const center = box.getCenter(new THREE.Vector3())
  scene.scale.setScalar(scale); scene.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale)
  const root = new THREE.Group(); root.add(scene); return root
}

describe('walking follows distance and deforms real mesh joints', () => {
  it('uses a verified captured walk cycle with continuous seams and no arm channels',()=>{
    expect(capturedWalkSource).toBe('CMU 07_01')
    const leg=.78,stride=leg*capturedStride
    const first=capturedWalk(stride*3,leg),next=capturedWalk(stride*4,leg)
    expect(first).toEqual(next)
    for(let i=0;i<40;i++)for(const l of capturedWalk(stride*(3+i/40),leg).legs){
      expect(Number.isFinite(l.down)&&Number.isFinite(l.forward)).toBe(true)
      expect(Math.hypot(l.down,l.forward)).toBeLessThan(leg*1.002)
    }
  })
  it('calibrates the whole attendant heading without twisting head and torso apart', () => {
    const height = 1.72, root = realModel('viewer/public/yuezhi/figures/yuezhi.glb', height)
    root.updateMatrixWorld(true)
    let original!: THREE.Mesh
    root.traverse(o => { if (o instanceof THREE.Mesh) original = o })
    const p = original.geometry.getAttribute('position'), matrix = root.matrixWorld.clone().invert().multiply(original.matrixWorld)
    const rotation=new THREE.Matrix4().makeRotationY(-Math.PI/3).multiply(matrix)
    const before = Array.from({ length: p.count }, (_, i) => new THREE.Vector3().fromBufferAttribute(p, i).applyMatrix4(rotation))
    const rig = bindWalkRig(root, height, 'human',false,-Math.PI/3)
    const position = rig.meshes[0]!.geometry.getAttribute('position')
    before.forEach((v, i) => { if (v.y > height * .60) expect(new THREE.Vector3().fromBufferAttribute(position, i).distanceTo(v)).toBeLessThan(.00001) })
  })
  it('has a frontal chest axis after calibration and preserves the actual texture',()=>{
    const h=1.72,root=realModel('viewer/public/yuezhi/figures/yuezhi.glb',h)
    root.updateMatrixWorld(true);let original!:THREE.Mesh
    root.traverse(o=>{if(o instanceof THREE.Mesh)original=o})
    const p=original.geometry.getAttribute('position'),matrix=root.matrixWorld.clone().invert().multiply(original.matrixWorld)
    const before=Array.from({length:p.count},(_,i)=>new THREE.Vector3().fromBufferAttribute(p,i).applyMatrix4(matrix))
    const rig=bindWalkRig(root,h,'human',false,-Math.PI/3),corrected=rig.meshes[0]!.geometry.getAttribute('position')
    for(const [low,high]of[[.60,.64],[.64,.68],[.68,.72],[.72,.76]]){
      const band=before.map((v,i)=>({v,i})).filter(({v})=>v.y>h*low!&&v.y<h*high!).map(({i})=>new THREE.Vector3().fromBufferAttribute(corrected,i))
      const center=band.reduce((s,v)=>s.add(v),new THREE.Vector3()).multiplyScalar(1/band.length)
      let xx=0,zz=0,xz=0
      for(const v of band){xx+=(v.x-center.x)**2;zz+=(v.z-center.z)**2;xz+=(v.x-center.x)*(v.z-center.z)}
      expect(Math.abs(.5*Math.atan2(2*xz,xx-zz))).toBeLessThan(THREE.MathUtils.degToRad(5))
    }
    expect(Array.from(rig.meshes[0]!.geometry.getAttribute('uv').array)).toEqual(Array.from(original.geometry.getAttribute('uv').array))
  })
  it('briefly looks aside and returns to facing forward',()=>{
    for(const phase of [.31,.68]){
      expect(passingGlance(7,phase)).toBe(0)
      expect(passingGlance(8+phase*.4+.16,phase)).toBeGreaterThan(.17)
      expect(passingGlance(8+phase*.4+.33,phase)).toBe(0)
      expect(passingGlance(12,phase)).toBe(0)
    }
  })
  it('walks without arm swings and keeps the staff grip fixed when stopped',()=>{
    const rig=bindWalkRig(realModel('viewer/public/yuezhi/figures/yuezhi.glb',1.72),1.72,'human',true,-Math.PI/3)
    const arms=rig.skeleton.bones.filter(b=>['left-arm','right-arm','forearm','hand'].includes(b.name))
    expect(arms).toHaveLength(6)
    rig.update(.5);const rotations=arms.map(b=>b.quaternion.toArray())
    rig.update(1.6);expect(arms.map(b=>b.quaternion.toArray())).toEqual(rotations)
    expect(rig.state().kneeAngles.some(v=>v!==0)).toBe(true)
    rig.update(1.6,0,true);expect(arms.map(b=>b.quaternion.toArray())).toEqual(rotations)
  })
  it('both monks face the arriving party, with opposite inward turns',()=>{
    const guest=new THREE.Vector3(0,0,-8)
    const hosts=[new THREE.Vector3(-1.6,0,-12),new THREE.Vector3(1.6,0,-12)]
    const forwards=hosts.map(host=>new THREE.Vector3(1,0,0).applyAxisAngle(new THREE.Vector3(0,1,0),greetingYaw(host,guest)))
    hosts.forEach((host,i)=>expect(forwards[i]!.dot(guest.clone().sub(host).normalize())).toBeCloseTo(1,10))
    expect(forwards[0]!.x).toBeGreaterThan(0);expect(forwards[1]!.x).toBeLessThan(0)
    expect(forwards.every(v=>v.z>0)).toBe(true)
  })
  it('keeps a planted foot fixed while its body advances', () => {
    for (const stride of [.42, .64]) for (const d of [.02, .10, .20]) {
      const a = stepTarget(d, stride), b = stepTarget(d + .01, stride)
      expect(a.stance && b.stance).toBe(true)
      expect(b.lift).toBe(0)
      expect((d + .01 + b.z) - (d + a.z)).toBeCloseTo(0, 10)
    }
  })
  it('has opposite leg phases and lifts a swing foot clear of the ground', () => {
    const left = stepTarget(.8, 1, 0, .12), right = stepTarget(.8, 1, .5, .12)
    expect(left.stance).toBe(false); expect(left.lift).toBeGreaterThan(.11)
    expect(right.stance).toBe(true); expect(right.lift).toBe(0)
  })
  it('two-link IK reaches the intended foot without stretching its bones', () => {
    for (const down of [.65, .72, .79]) for (const forward of [-.12, .12]) {
      const { hip, knee } = solveLeg(down, forward, .4, .4)
      expect(.4 * Math.cos(hip) + .4 * Math.cos(hip + knee)).toBeCloseTo(down, 8)
      expect(-.4 * Math.sin(hip) - .4 * Math.sin(hip + knee)).toBeCloseTo(forward, 8)
    }
  })
  it('deforms vertices, preserves texture coordinates and freezes at identical route distance', () => {
    const root = realModel('viewer/public/yuezhi/figures/envoy.glb', 1.75)
    let original!: THREE.Mesh
    root.traverse(o => { if (o instanceof THREE.Mesh) original = o })
    const uv = Array.from(original.geometry.getAttribute('uv').array)
    const rig = bindWalkRig(root, 1.75, 'human')
    expect(rig.meshes[0]!.isSkinnedMesh).toBe(true)
    expect(Array.from(rig.meshes[0]!.geometry.getAttribute('uv').array)).toEqual(uv)
    const mesh = rig.meshes[0]!, point = new THREE.Vector3()
    const position = mesh.geometry.getAttribute('position')
    const index = Array.from({ length: position.count }, (_, i) => i).find(i => position.getY(i) < .1 && position.getX(i) < 0)!
    rig.update(.5); const first = mesh.applyBoneTransform(index, point.fromBufferAttribute(position, index)).clone()
    rig.update(.62); const second = mesh.applyBoneTransform(index, point.fromBufferAttribute(position, index)).clone()
    expect(first.distanceTo(second)).toBeGreaterThan(.03)
    const state = rig.state(); rig.update(.62); expect(rig.state()).toEqual(state)
    rig.update(.62, 0, true); expect(rig.state().kneeAngles.every(v => v === 0)).toBe(true)
  })
  it('gives the horse four independent legs rather than bobbing a static whole model', () => {
    const root = new THREE.Group(); const geometry = new THREE.BoxGeometry(.6, 1.9, 2.2, 2, 12, 2); geometry.translate(0, .95, 0)
    root.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial()))
    const rig = bindWalkRig(root, 1.9, 'horse'); rig.update(1.1)
    expect(rig.legs).toHaveLength(4)
    expect(new Set(rig.state().kneeAngles.map(v => v.toFixed(4))).size).toBeGreaterThan(2)
  })
  for (const [path, height, yaw] of [['viewer/public/yuezhi/figures/envoy.glb', 1.75, 0], ['viewer/public/yuezhi/figures/yuezhi.glb', 1.72, -Math.PI/3]] as const) {
    it(`keeps the actual imported ${path} supporting boot on the ground`, () => {
      const rig = bindWalkRig(realModel(path, height), height, 'human', false, yaw)
      const mesh = rig.meshes[0]!, position = mesh.geometry.getAttribute('position'), stride = (rig.legs[0]!.upperLength+rig.legs[0]!.lowerLength)*capturedStride
      const soles = [-1,1].map(side=>Array.from({ length: position.count }, (_, i) => i).filter(i => position.getY(i) < height*.055 && position.getX(i)*side>0))
      expect(soles.every(s=>s.length>8)).toBe(true)
      for (let phase=0;phase<=40;phase++) {
        rig.update(stride * (3 + phase/40))
        const heights=soles.flatMap(sole=>sole.map(index=>mesh.applyBoneTransform(index,new THREE.Vector3().fromBufferAttribute(position,index)).y))
        // Heel contact, flat support and toe-off do not put the whole shoe
        // flat on the floor. Require real contact and prevent penetration.
        expect(Math.min(...heights)).toBeGreaterThan(-.005)
        expect(Math.min(...heights)).toBeLessThan(.005)
        expect(heights.filter(y=>Math.abs(y)<.01).length).toBeGreaterThan(20)
      }
    })
    it(`keeps ${path} boots facing forward on separate tracks throughout a complete stride`, () => {
      const rig = bindWalkRig(realModel(path, height), height, 'human', false, yaw)
      const mesh = rig.meshes[0]!, position = mesh.geometry.getAttribute('position'), stride = (rig.legs[0]!.upperLength+rig.legs[0]!.lowerLength)*capturedStride
      // Include each whole corrected sole; truncating at an interior X threshold
      // biases the covariance angle of an asymmetric shoe.
      const feet = [-1, 1].map(side => Array.from({ length: position.count }, (_, i) => i).filter(i => position.getY(i) < height * .055 && position.getX(i) * side > 0))
      for (let step = 0; step <= 20; step++) {
        rig.update(stride * (3 + step / 20))
        const footprints = feet.map(indices => indices.map(i => mesh.applyBoneTransform(i, new THREE.Vector3().fromBufferAttribute(position, i))))
        expect(Math.max(...footprints[0]!.map(p => p.x))).toBeLessThan(-.02)
        expect(Math.min(...footprints[1]!.map(p => p.x))).toBeGreaterThan(.02)
        for (const footprint of footprints) {
          const mean = footprint.reduce((sum, p) => sum.add(p), new THREE.Vector3()).multiplyScalar(1 / footprint.length)
          let xx = 0, zz = 0, xz = 0
          for (const p of footprint) { xx += (p.x - mean.x) ** 2; zz += (p.z - mean.z) ** 2; xz += (p.x - mean.x) * (p.z - mean.z) }
          expect(Math.abs(.5 * Math.atan2(2 * xz, zz - xx))).toBeLessThan(THREE.MathUtils.degToRad(5))
          expect(Math.min(...footprint.map(p => p.y))).toBeGreaterThan(-.02)
        }
      }
    })
    it(`keeps ${path} connected coat triangles continuous across both leg tracks`, () => {
      const root = realModel(path, height)
      root.updateMatrixWorld(true)
      let original!: THREE.Mesh
      root.traverse(o => { if (o instanceof THREE.Mesh) original = o })
      const matrix = new THREE.Matrix4().makeRotationY(yaw).multiply(root.matrixWorld.clone().invert().multiply(original.matrixWorld))
      const attribute = original.geometry.getAttribute('position'), indices = original.geometry.getIndex()!
      const before = Array.from({ length: attribute.count }, (_, i) => new THREE.Vector3().fromBufferAttribute(attribute, i).applyMatrix4(matrix))
      const crossing: number[][] = []
      for (let i = 0; i < indices.count; i += 3) {
        const ids = [indices.getX(i), indices.getX(i + 1), indices.getX(i + 2)]
        const points = ids.map(j => before[j]!)
        if (points.every(p => p.y > height * .12 && p.y < height * .50) && Math.min(...points.map(p => p.x)) < 0 && Math.max(...points.map(p => p.x)) > 0) crossing.push(ids)
      }
      expect(crossing.length).toBeGreaterThan(30)
      const rig = bindWalkRig(root, height, 'human', false, yaw), mesh = rig.meshes[0]!, position = mesh.geometry.getAttribute('position')
      for (let step = 0; step <= 10; step++) {
        rig.update((rig.legs[0]!.upperLength+rig.legs[0]!.lowerLength)*capturedStride * (3 + step / 10))
        for (const ids of crossing) for (let k = 0; k < 3; k++) {
          const a = ids[k]!, b = ids[(k + 1) % 3]!
          const oldLength = before[a]!.distanceTo(before[b]!)
          const pa = mesh.applyBoneTransform(a, new THREE.Vector3().fromBufferAttribute(position, a))
          const pb = mesh.applyBoneTransform(b, new THREE.Vector3().fromBufferAttribute(position, b))
          if (oldLength > .002) expect(pa.distanceTo(pb) / oldLength).toBeLessThan(4)
        }
      }
    })
  }
})
