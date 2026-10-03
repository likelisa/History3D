import * as THREE from 'three'
import {capturedWalk,capturedStride,capturedWalkSource} from './captured-walk.ts'

type Leg = {
  upper: THREE.Bone; lower: THREE.Bone; foot: THREE.Bone
  x: number; y: number; z: number; ankleZ: number
  upperLength: number; lowerLength: number; upperPitch: number; lowerPitch: number
  upperIndex: number; lowerIndex: number; footIndex: number
  phase: number
}
type Arm = { upper: THREE.Bone; lower: THREE.Bone; hand: THREE.Bone; upperIndex: number; lowerIndex: number; handIndex: number }
export type WalkRig = {
  skeleton: THREE.Skeleton; meshes: THREE.SkinnedMesh[]; legs: Leg[]
  rightHand?: THREE.Bone; update(distance: number, phase?: number, stopped?: boolean,weight?:number): void
  state(): { phase: number; footLifts: number[]; kneeAngles: number[]; headYaw: number;source:string }
}

const smooth = (value: number, min: number, max: number) => THREE.MathUtils.smoothstep(value, min, max)
const fract = (value: number) => value - Math.floor(value)

/** A planted foot retreats by exactly the distance the body advances during stance. */
export function stepTarget(distance: number, stride: number, phase = 0, lift = .1) {
  const u = fract(distance / stride + phase), stance = .62
  if (u < stance) return { phase: u, z: stride * (stance / 2 - u), lift: 0, stance: true }
  const swing = (u - stance) / (1 - stance)
  const eased = swing * swing * (3 - 2 * swing)
  return { phase: u, z: stride * stance * (eased - .5), lift: lift * Math.sin(Math.PI * swing), stance: false }
}

/** Solve a two-link leg in its sagittal plane; each imported leg keeps its bind pose. */
export function solveLeg(down: number, forward: number, upper: number, lower: number) {
  const reach = THREE.MathUtils.clamp(Math.hypot(down, forward), Math.abs(upper - lower) + .0001, upper + lower - .0001)
  const bend = Math.PI - Math.acos(THREE.MathUtils.clamp((upper * upper + lower * lower - reach * reach) / (2 * upper * lower), -1, 1))
  const hip = -Math.atan2(forward, down) - Math.acos(THREE.MathUtils.clamp((upper * upper + reach * reach - lower * lower) / (2 * upper * reach), -1, 1))
  return { hip, knee: bend }
}

/** Align the authored standing pose before binding a forward walking skeleton.
 * The two real figures have asymmetric authored standing poses and splayed
 * boots. Their original files/UVs stay intact; only this runtime mesh is posed.
 */
function neutralizeFeet(geometries: THREE.BufferGeometry[], height: number) {
  const points = geometries.flatMap(geometry => {
    const p = geometry.getAttribute('position')
    return Array.from({ length: p.count }, (_, i) => new THREE.Vector3().fromBufferAttribute(p, i))
  })
  const ankleZ = -height * .025, halfWidth = height * .085
  const mean = (items: THREE.Vector3[]) => items.reduce((sum, p) => sum.add(p), new THREE.Vector3()).multiplyScalar(1 / items.length)
  const ankleBand = points.filter(p => Math.abs(p.y - height * .09) < height * .02)
  if (ankleBand.length < 16) throw new Error('步行动作校准失败：无法定位踝关节')
  // A generated standing pose can put one foot ahead of the other or turn a
  // toe across the body midline. Cluster the two ankles in X/Z; splitting the
  // original mesh by X alone would assign part of one shoe to the other leg.
  let centers = [ankleBand.reduce((a, b) => a.x < b.x ? a : b).clone(), ankleBand.reduce((a, b) => a.x > b.x ? a : b).clone()]
  const distance = (p: THREE.Vector3, c: THREE.Vector3) => (p.x - c.x) ** 2 + (p.z - c.z) ** 2
  for (let iteration = 0; iteration < 12; iteration++) {
    const clusters = [[], []] as THREE.Vector3[][]
    for (const p of ankleBand) clusters[distance(p, centers[0]!) < distance(p, centers[1]!) ? 0 : 1]!.push(p)
    if (clusters.some(cluster => cluster.length < 8)) throw new Error('步行动作校准失败：踝关节分组无效')
    centers = clusters.map(mean)
  }
  centers.sort((a, b) => a.x - b.x)
  const feet = centers.map((a, index) => {
    const side = index === 0 ? -1 : 1
    const sole = points.filter(p => p.y < height * .055 && (distance(p, centers[0]!) < distance(p, centers[1]!) ? 0 : 1) === index)
    const ankle = ankleBand.filter(p => (distance(p, centers[0]!) < distance(p, centers[1]!) ? 0 : 1) === index)
    if (sole.length < 8 || ankle.length < 8) throw new Error('步行动作校准失败：无法定位左右脚')
    const c = mean(sole)
    let xx = 0, zz = 0, xz = 0
    for (const p of sole) { xx += (p.x - c.x) ** 2; zz += (p.z - c.z) ** 2; xz += (p.x - c.x) * (p.z - c.z) }
    // Principal sole axis measured from +Z, constrained to the forward half.
    const toeYaw = .5 * Math.atan2(2 * xz, zz - xx)
    return { side, ankle: a, toeYaw, shiftX: side * halfWidth - a.x, shiftZ: ankleZ - a.z }
  })
  const mid = centers[0]!.clone().add(centers[1]!).multiplyScalar(.5)
  const separatingAxis = centers[1]!.clone().sub(centers[0]!); separatingAxis.y = 0; separatingAxis.normalize()
  for (const geometry of geometries) {
    const p = geometry.getAttribute('position')
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i)
      const rotate = 1 - smooth(y, height * .075, height * .16)
      const translate = 1 - smooth(y, height * .22, height * .51)
      const width = height * .10 * smooth(y, height * .10, height * .14)
      const split = (x - mid.x) * separatingAxis.x + (z - mid.z) * separatingAxis.z
      const side = width > 0 ? smooth(split, -width, width) : split < 0 ? 0 : 1
      const corrections = feet.map(foot => {
        const angle = -foot.toeYaw * rotate, dx = x - foot.ankle.x, dz = z - foot.ankle.z
        return { x: foot.ankle.x + dx * Math.cos(angle) + dz * Math.sin(angle) + foot.shiftX * translate,
          z: foot.ankle.z - dx * Math.sin(angle) + dz * Math.cos(angle) + foot.shiftZ * translate }
      })
      // The coat is connected across the midline, unlike the separate boots.
      // A continuous correction prevents a seam tearing between leg tracks.
      p.setXYZ(i, THREE.MathUtils.lerp(corrections[0]!.x, corrections[1]!.x, side), y,
        THREE.MathUtils.lerp(corrections[0]!.z, corrections[1]!.z, side))
    }
    p.needsUpdate = true; geometry.computeVertexNormals()
  }
  return { ankleZ, halfWidth }
}

/** A single short glance returns to forward; it is not a permanent neck turn. */
export function passingGlance(distance: number, offset=0) {
  const u=(distance-(8+offset*.4))/.32
  return u>0 && u<1 ? Math.sin(u*Math.PI)*.18 : 0
}

/** Bind the preserved, textured Tripo mesh at runtime; never replace it with a proxy. */
export function bindWalkRig(model: THREE.Group, height: number, kind: 'human' | 'horse', carriesStaff = false, sourceYaw = 0): WalkRig {
  model.updateMatrixWorld(true)
  const inverse = model.matrixWorld.clone().invert()
  const originals: { geometry: THREE.BufferGeometry; material: THREE.Material | THREE.Material[]; name: string }[] = []
  model.traverse(object => {
    if (object instanceof THREE.Mesh) originals.push({ geometry: object.geometry.clone().applyMatrix4(inverse.clone().multiply(object.matrixWorld)), material: object.material, name: object.name })
  })
  if (!originals.length) throw new Error('步行动作绑定失败：缺少真实网格')
  // Heading correction belongs to geometry, before left/right weights and IK.
  for (const source of originals) source.geometry.rotateY(sourceYaw)
  const humanRest = kind === 'human' ? neutralizeFeet(originals.map(source => source.geometry), height) : null
  model.clear()
  const bones: THREE.Bone[] = []
  const bone = (name: string, parent: THREE.Object3D, x: number, y: number, z: number) => {
    const b = new THREE.Bone(); b.name = name; b.position.set(x, y, z); parent.add(b); bones.push(b); return b
  }
  const pelvisY = height * (kind === 'human' ? .51 : .52)
  const pelvis = bone('walk-pelvis', model, 0, pelvisY, 0)
  const spine = bone('walk-spine', pelvis, 0, height * .15, 0)
  const head = bone('walk-head', spine, 0, height * .22, kind === 'horse' ? height * .32 : 0)
  const legs: Leg[] = [], arms: Arm[] = []
  function leg(name: string, x: number, hipY: number, hipZ: number, kneeY: number, kneeZ: number, ankleY: number, ankleZ: number, phase: number) {
    const upper = bone(name + '-thigh', pelvis, x, hipY - pelvisY, hipZ)
    const upperIndex = bones.indexOf(upper)
    const lower = bone(name + '-shin', upper, 0, kneeY - hipY, kneeZ - hipZ)
    const lowerIndex = bones.indexOf(lower)
    const foot = bone(name + '-foot', lower, 0, ankleY - kneeY, ankleZ - kneeZ)
    legs.push({ upper, lower, foot, x, y: hipY, z: hipZ, ankleZ,
      upperLength: Math.hypot(kneeY - hipY, kneeZ - hipZ), lowerLength: Math.hypot(ankleY - kneeY, ankleZ - kneeZ),
      upperPitch: Math.atan2(-(kneeZ - hipZ), hipY - kneeY), lowerPitch: Math.atan2(-(ankleZ - kneeZ), kneeY - ankleY),
      upperIndex, lowerIndex, footIndex: bones.indexOf(foot), phase })
  }
  if (kind === 'human') {
    for (const side of [-1, 1]) leg(side < 0 ? 'left' : 'right', side * humanRest!.halfWidth, height * .51, humanRest!.ankleZ, height * .28, humanRest!.ankleZ, height * .065, humanRest!.ankleZ, side < 0 ? 0 : .5)
    for (const side of [-1, 1]) {
      const upper = bone(side < 0 ? 'left-arm' : 'right-arm', spine, side * height * .14, height * .11, 0)
      const lower = bone('forearm', upper, side * height * .025, -height * .18, 0)
      const hand = bone('hand', lower, side * height * .008, -height * .14, 0)
      arms.push({ upper, lower, hand, upperIndex: bones.indexOf(upper), lowerIndex: bones.indexOf(lower), handIndex: bones.indexOf(hand) })
    }
  } else {
    // The imported horse faces +Z. Four offsets make a walk, rather than a trot.
    leg('hind-left', -height * .13, height * .51, -height * .31, height * .28, -height * .30, height * .05, -height * .26, 0)
    leg('fore-left', -height * .13, height * .55, height * .25, height * .29, height * .28, height * .05, height * .30, .75)
    leg('hind-right', height * .13, height * .51, -height * .31, height * .28, -height * .30, height * .05, -height * .26, .5)
    leg('fore-right', height * .13, height * .55, height * .25, height * .29, height * .28, height * .05, height * .30, .25)
  }
  const skeleton = new THREE.Skeleton(bones)
  const meshes: THREE.SkinnedMesh[] = []
  for (const source of originals) {
    const geometry = source.geometry, positions = geometry.getAttribute('position')
    const indices = new Uint16Array(positions.count * 4), weights = new Float32Array(positions.count * 4)
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i)
      const w = new Map<number, number>()
      const add = (index: number, value: number) => { if (value > .00001) w.set(index, (w.get(index) ?? 0) + value) }
      const armRegion = kind === 'human' ? smooth(Math.abs(x), height * .105, height * .14) *
        smooth(y, height * .30, height * .34) * (1 - smooth(y, height * .77, height * .88)) : 0
      // A lowered hand can sit below the waist. Lateral hand/forearm vertices
      // must belong to the fixed upper body even when their Y matches a thigh.
      // Blend the region edge into cloth, then exclude leg weights throughout
      // the arm region; multiplying arm weights by waist height left real hands
      // following the opposite walking leg on the new independently generated bodies.
      // Use the observed low fingertips (down to .35h), rather than the waist,
      // to set the lower edge. Boots remain below this fixed upper-body region.
      const body = kind === 'human' ? Math.max(smooth(y, height * .45, height * .60), smooth(armRegion, .15, .45)) : smooth(y, height * .42, height * .58)
      // Boots belong to one leg; connected cloth blends smoothly across the
      // midline so its inner edge is not torn by the opposite leg.
      const clothWidth = height * .10 * smooth(y, height * .10, height * .14)
      const side = kind === 'human' ? (clothWidth > 0 ? smooth(x, -clothWidth, clothWidth) : x < 0 ? 0 : 1) : smooth(x, -height * .025, height * .025)
      const arm = armRegion
      const headWeight = smooth(y, height * .84, height * .92)
      const torsoWeight = smooth(y, height * .60, height * .73)
      add(0, (body - arm) * (1 - torsoWeight)); add(1, (body - arm) * torsoWeight * (1 - headWeight)); add(2, (body - arm) * torsoWeight * headWeight)
      for (const [j, a] of arms.entries()) {
        const amount = arm * (j === 0 ? 1 - side : side)
        const lower = 1 - smooth(y, height * .52, height * .64), hand = 1 - smooth(y, height * .43, height * .49)
        add(a.upperIndex, amount * (1 - lower)); add(a.lowerIndex, amount * lower * (1 - hand)); add(a.handIndex, amount * lower * hand)
      }
      for (const [j, l] of legs.entries()) {
        const sideWeight = l.x < 0 ? 1 - side : side
        const front = kind === 'horse' ? smooth(z, -height * .08, height * .13) : 0
        const region = kind === 'human' ? 1 : j % 2 === 0 ? 1 - front : front
        const amount = (1 - body) * sideWeight * region
        const lower = 1 - smooth(y, height * (kind === 'human' ? .22 : .23), height * .33)
        const foot = 1 - smooth(y, height * (kind === 'human' ? .075 : .045), height * (kind === 'human' ? .14 : .12))
        add(l.upperIndex, amount * (1 - lower)); add(l.lowerIndex, amount * lower * (1 - foot)); add(l.footIndex, amount * lower * foot)
      }
      const influence = [...w].sort((a, b) => b[1] - a[1]).slice(0, 4)
      const sum = influence.reduce((total, [, value]) => total + value, 0)
      if (!sum) throw new Error('步行动作绑定失败：无效权重')
      influence.forEach(([index, value], k) => { indices[i * 4 + k] = index; weights[i * 4 + k] = value / sum })
    }
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4))
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4))
    const mesh = new THREE.SkinnedMesh(geometry, source.material)
    mesh.name = source.name + '-walking'; mesh.castShadow = true; mesh.receiveShadow = true
    // Imported static bounds would wrongly cull extended feet.
    mesh.frustumCulled = false; model.add(mesh); meshes.push(mesh)
  }
  model.updateMatrixWorld(true)
  for (const mesh of meshes) mesh.bind(skeleton)
  const soles=kind==='human'?meshes.map(mesh=>{
    const p=mesh.geometry.getAttribute('position')
    const indices=Array.from({length:p.count},(_,i)=>i).filter(i=>p.getY(i)<height*.055)
    // Uniform samples plus the original extrema keep the preserved boots
    // grounded while adopting heel/toe pitch from a different captured actor.
    const chosen=new Set(indices.filter((_,i)=>i%Math.max(1,Math.floor(indices.length/192))===0))
    for(const axis of ['X','Y','Z'] as const)for(const direction of [-1,1])chosen.add(indices.reduce((a,b)=>p[`get${axis}`](a)*direction<p[`get${axis}`](b)*direction?a:b))
    return{mesh,indices:[...chosen]}
  }):[]
  let currentPhase = 0, lifts = legs.map(() => 0)
  return {
    skeleton, meshes, legs, rightHand: arms[1]?.hand,
    update(distance, phase = 0, stopped = false,weight=1) {
      const legLength=legs[0]!.upperLength+legs[0]!.lowerLength
      const captured=kind==='human'?capturedWalk(distance,legLength,phase):null
      const stride = kind === 'human' ? legLength*capturedStride : height * .34
      const cycle = distance / stride + phase, u = fract(cycle)
      currentPhase = u
      const blend = stopped ? 0 : smooth(distance, 0, .25)*THREE.MathUtils.clamp(weight,0,1)
      const bob = captured?captured.pelvis*blend:(1 - Math.cos(u * Math.PI * 4)) * height * .003 * blend
      // Leave enough leg reach for a planted foot ahead/behind the pelvis.
      const pelvisShift = bob - height * (kind === 'human' ? 0 : .025) * blend
      pelvis.position.y = pelvisY + pelvisShift
      // Keep the feet on two separate forward tracks, without lateral crossing.
      pelvis.rotation.z = 0
      spine.rotation.y = 0
      head.rotation.y = -spine.rotation.y * .6 + (kind==='human' ? passingGlance(distance,phase)*(phase<.5?-1:1)*blend : 0)
      lifts = []
      for (const [index,l] of legs.entries()) {
        const target = stepTarget(distance, stride, phase + l.phase, height * (kind === 'human' ? .04 : .045))
        const ankleY = height * (kind === 'human' ? .065 : .05)
        const observed=captured?.legs[index]
        const ik = solveLeg(observed?.down??l.y + pelvisShift - ankleY - target.lift,observed?.forward??l.ankleZ - l.z + target.z, l.upperLength, l.lowerLength)
        l.upper.rotation.x = (ik.hip - l.upperPitch) * blend
        l.lower.rotation.x = (ik.knee - l.lowerPitch + l.upperPitch) * blend
        // Keep the captured roll modest for the preserved wide boots. Foot
        // yaw and lateral capture drift are omitted so both tracks face ahead.
        l.foot.rotation.x = -l.upper.rotation.x - l.lower.rotation.x-(observed?THREE.MathUtils.clamp(observed.footPitch,-.18,.18)*blend:0)
        lifts.push((observed?.lift??target.lift) * blend)
      }
      for (const [j, a] of arms.entries()) {
        const carrying = carriesStaff && j === 1
        // Keep both arms fixed. The user's final walking direction excludes
        // arm swings; the staff keeps a stable grip through walking and stops.
        a.upper.rotation.x = carrying ? -.10 : 0
        a.lower.rotation.x = carrying ? -.18 : 0
      }
      model.updateMatrixWorld(true); skeleton.update()
      if(captured&&blend>0){
        let minY=Infinity;const point=new THREE.Vector3()
        for(const sole of soles){const p=sole.mesh.geometry.getAttribute('position');for(const i of sole.indices)minY=Math.min(minY,sole.mesh.applyBoneTransform(i,point.fromBufferAttribute(p,i)).y)}
        pelvis.position.y-=minY
        model.updateMatrixWorld(true);skeleton.update()
      }
    },
    state: () => ({ phase: currentPhase, footLifts: [...lifts], kneeAngles: legs.map(l => l.lower.rotation.x), headYaw:head.rotation.y,source:kind==='human'?capturedWalkSource:'four-beat horse walk' }),
  }
}
