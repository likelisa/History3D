import * as THREE from 'three'
import { bindWalkRig } from './walking.ts'

export type GuardVariantId = 'older-mantle' | 'younger-bow'
export const guardVariantSource = {
  file: '/yuezhi/figures/xiongnu.glb',
  sha256: '1802a80083cd118295717f6e405a5bc98b99a48406dd2074c1a580c7a591f47f',
  historicalStatus: 'Anonymous interpretive figures; age, colours, wardrobe and guard roles are not attested uniforms',
} as const

/** Authored raster weave on separate accessories; original face/PBR maps stay intact. */
function wovenMaterial(colour: string, seed: number, fibre = true) {
  const size = 256, colourValue = new THREE.Color(colour)
  const base = new Uint8Array(size * size * 4), normal = new Uint8Array(base.length), rough = new Uint8Array(base.length)
  let n = seed
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    n = (Math.imul(n, 1664525) + 1013904223) >>> 0
    const index = (y * size + x) * 4, noise = n / 4294967296 - .5
    const weave = fibre ? .045 * Math.sin(x * Math.PI) + .04 * Math.cos(y * Math.PI) : 0
    const shade = 1 + noise * .13 + weave
    // Colour values for an sRGB raster, with authored small-scale weave normals.
    const c = colourValue.clone().convertLinearToSRGB()
    base[index] = Math.min(255, Math.round(c.r * shade * 255))
    base[index + 1] = Math.min(255, Math.round(c.g * shade * 255))
    base[index + 2] = Math.min(255, Math.round(c.b * shade * 255)); base[index + 3] = 255
    normal[index] = 128 + (fibre ? (x % 2 ? 5 : -5) : Math.round(noise * 6))
    normal[index + 1] = 128 + (fibre ? (y % 2 ? 5 : -5) : Math.round(noise * 6))
    normal[index + 2] = 254; normal[index + 3] = 255
    rough[index] = rough[index + 1] = rough[index + 2] = Math.round(231 + noise * 12); rough[index + 3] = 255
  }
  const texture = (data: Uint8Array) => {
    const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat)
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.needsUpdate = true
    return t
  }
  const map = texture(base); map.colorSpace = THREE.SRGBColorSpace
  const result = new THREE.MeshStandardMaterial({ map, normalMap: texture(normal), roughnessMap: texture(rough),
    roughness: .96, metalness: 0, side: THREE.DoubleSide })
  result.name = 'Authored guard accessory ' + colour
  return result
}

function addMesh(parent: THREE.Object3D, name: string, geometry: THREE.BufferGeometry, material: THREE.Material) {
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = name; mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh)
  return mesh
}

function curvedTube(parent: THREE.Object3D, name: string, points: number[][], radius: number, material: THREE.Material) {
  const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(p[0], p[1], p[2])))
  return addMesh(parent, name, new THREE.TubeGeometry(curve, 28, radius, 8, false), material)
}

function surface(parent: THREE.Object3D, name: string, rows: number[][][], material: THREE.Material) {
  const vertices: number[] = [], uv: number[] = [], indices: number[] = []
  const columns = rows[0]!.length
  for (const [j, row] of rows.entries()) for (const [i, v] of row.entries()) {
    vertices.push(v[0]!, v[1]!, v[2]!); uv.push(i / (columns - 1), j / (rows.length - 1))
    if (i && j) { const a = j * columns + i; indices.push(a, a - 1, a - columns, a - 1, a - columns - 1, a - columns) }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  geometry.setIndex(indices); geometry.computeVertexNormals()
  return addMesh(parent, name, geometry, material)
}

/** Create a distinct static person from the real textured Tripo body.
 * The template must be a canonical +Z-facing model, grounded and scaled in metres.
 * Actor yaw is applied by the caller to this whole group, never separately to its head.
 */
export function createGuardVariant(template: THREE.Group, variant: GuardVariantId, height = 1.72): THREE.Group {
  const clone = template.clone(true)
  clone.position.set(0, 0, 0); clone.rotation.set(0, 0, 0)
  const bounds = new THREE.Box3().setFromObject(clone), centre = bounds.getCenter(new THREE.Vector3())
  const sourceHeight = bounds.max.y - bounds.min.y
  if(sourceHeight < .1 || !Number.isFinite(height) || height <= 0) throw new Error('匈奴人物变体尺寸无效')
  const bodyScale = height / sourceHeight
  clone.scale.multiplyScalar(bodyScale)
  clone.position.set(-centre.x*bodyScale,-bounds.min.y*bodyScale,-centre.z*bodyScale)
  // Scale inside a unit outer group: bindWalkRig measures geometry in this
  // group's metres, so its skeleton and accessory positions match the person.
  const body = new THREE.Group(); body.add(clone)
  body.name = 'Anonymous guard ' + variant
  const rig = bindWalkRig(body, height, 'human')
  rig.update(0, 0, true)
  const scale = height / 1.72
  // Clothing-only vertex tint multiplies the original mapped garment pixels.
  // Above the collar, hands, trousers, boots and metal belt stay pure white.
  for (const mesh of rig.meshes) {
    const positions = mesh.geometry.getAttribute('position')
    const colours = new Float32Array(positions.count * 3)
    const tint = variant === 'older-mantle' ? [.90, .90, .96] : [.56, 1.08, .76]
    for (let i = 0; i < positions.count; i++) {
      const y = positions.getY(i) / height, x = Math.abs(positions.getX(i)) / height
      const torso = x < .16 && y > .58 && y < .80
      const skirt = x < .19 && y > .29 && y < .51
      // Keep the entire sleeve/hand region untouched: Tripo's cuffs blend
      // into wrist skin, so height alone cannot safely separate those pixels.
      const garment = torso || skirt
      colours[i * 3] = garment ? tint[0]! : 1
      colours[i * 3 + 1] = garment ? tint[1]! : 1
      colours[i * 3 + 2] = garment ? tint[2]! : 1
    }
    mesh.geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3))
    const customise = (material: THREE.Material) => {
      const copy = material.clone()
      if (copy instanceof THREE.MeshStandardMaterial) copy.vertexColors = true
      return copy
    }
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(customise) : customise(mesh.material)
    mesh.userData.guardSourceBody = true
  }
  // Fixed restrained hand positions; leg/head bones remain forward and planted.
  const right = rig.skeleton.bones.find(b => b.name === 'right-arm')!
  const left = rig.skeleton.bones.find(b => b.name === 'left-arm')!
  right.rotation.x = variant === 'older-mantle' ? -.10 : -.025
  left.rotation.x = variant === 'younger-bow' ? -.07 : 0
  const rightHand = rig.rightHand!
  const leftHand = left.children[0]!.children[0]!
  body.updateMatrixWorld(true); rig.skeleton.update()
  // The generated hands are farther out than a generic hand-bone pivot.
  // Measure their actual posed geometry so held objects meet the fingers.
  const handAttachment = (hand: THREE.Object3D, side: number) => {
    const centre = new THREE.Vector3(), point = new THREE.Vector3()
    let count = 0
    for (const mesh of rig.meshes) {
      const positions = mesh.geometry.getAttribute('position')
      for (let i = 0; i < positions.count; i++) {
        const y = positions.getY(i) / height
        if (side * positions.getX(i) > height * .23 && y > .37 && y < .51) {
          centre.add(mesh.applyBoneTransform(i, point.fromBufferAttribute(positions, i))); count++
        }
      }
    }
    if (!count) throw new Error('匈奴人物持物定位失败：未找到真实手部网格')
    centre.multiplyScalar(1 / count); centre.z += height * .012
    const grip = new THREE.Group(); grip.name = 'Measured guard hand grip'
    grip.position.copy(hand.worldToLocal(body.localToWorld(centre))); hand.add(grip)
    return grip
  }
  const holdingHand = variant === 'older-mantle' ? handAttachment(rightHand, 1) : handAttachment(leftHand, -1)
  const clothing = new THREE.Group(); clothing.name = 'Distinct interpretive wardrobe'; clothing.scale.setScalar(scale); body.add(clothing)
  const wool = wovenMaterial(variant === 'older-mantle' ? '#716859' : '#545a47', variant === 'older-mantle' ? 72 : 43)
  const leather = wovenMaterial('#423425', 85, false), wood = wovenMaterial('#514333', 63, false)
  const features: string[] = []
  if (variant === 'older-mantle') {
    features.push('rounded felt cap', 'woven shoulder mantle', 'short grey beard', 'grey temple hair', 'plain lowered timber baton')
    const cap = addMesh(clothing, 'Older guard rounded felt cap', new THREE.SphereGeometry(1, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), wool)
    const capPoints = cap.geometry.getAttribute('position')
    for(let i=0;i<capPoints.count;i++){
      const x=capPoints.getX(i),y=capPoints.getY(i),z=capPoints.getZ(i)
      capPoints.setXYZ(i,x+.065*y*y,y*(1+.018*Math.sin(Math.atan2(z,x)*7)),z)
    }
    cap.geometry.computeVertexNormals()
    cap.position.set(0, 1.645, -.005); cap.scale.set(.119, .099, .145)
    const band = addMesh(clothing, 'Older guard folded felt cap edge', new THREE.CylinderGeometry(.120, .119, .043, 32, 1, true), wool)
    band.position.set(0, 1.651, -.005); band.scale.z = 1.21
    const rows: number[][][] = []
    for (let j = 0; j <= 8; j++) {
      const t = j / 8, row: number[][] = []
      for (let i = 0; i <= 64; i++) {
        const a = i / 64 * Math.PI * 2
        row.push([Math.sin(a) * (.135 + t * .23), 1.43 - t * .23 + .015 * Math.cos(a * 5) * t + .023 * Math.sin(a * 12) * Math.sin(t * Math.PI),
          Math.cos(a) * (.155 + t * .12) - .025])
      }
      rows.push(row)
    }
    surface(clothing, 'Older guard short woven shoulder mantle', rows, wool)
    const hair = wovenMaterial('#777368', 93, false)
    const beardRows: number[][][] = []
    for (let j = 0; j <= 9; j++) {
      const t = j / 9, row: number[][] = []
      for (let i = 0; i <= 12; i++) {
        const u = i / 12 * 2 - 1
        row.push([u * (.069 - t * .035), 1.487 - .034 * t + Math.abs(u) * .029,
          .140 - t * .019 - u * u * .033 + .001 * Math.sin(i * 2.7)])
      }
      beardRows.push(row)
    }
    surface(clothing, 'Older guard short grey chin and jaw beard', beardRows, hair)
    for (const side of [-1, 1]) {
      const temple = addMesh(clothing, 'Older guard grey temple hair', new THREE.SphereGeometry(1, 16, 10), hair)
      temple.position.set(side * .099, 1.601, .015); temple.scale.set(.014, .048, .059)
    }
    const baton = curvedTube(holdingHand, 'Older guard ordinary timber baton', [[0, -.44 * scale, .025 * scale],
      [0, 0, .025 * scale], [.015 * scale, .33 * scale, .025 * scale]], .015 * scale, wood)
    baton.userData.isHanCredential = false
  } else {
    features.push('dark cap band', 'olive brown woven robe', 'diagonal leather strap', 'belt pouch', 'lowered unstrung bow')
    const band = addMesh(clothing, 'Younger guard dark leather cap band', new THREE.CylinderGeometry(.120, .118, .031, 32, 1, true), leather)
    band.position.set(0, 1.647, -.005); band.scale.z = 1.18
    const strapRows: number[][][] = []
    for (let j = 0; j <= 12; j++) {
      const t = j / 12, x = -.205 + .35 * t, y = 1.395 - .39 * t
      strapRows.push([[x - .024, y - .017, .211 - .016 * Math.sin(t * Math.PI)],
        [x + .024, y + .017, .211 - .016 * Math.sin(t * Math.PI)]])
    }
    surface(clothing, 'Younger guard diagonal leather carrying strap', strapRows, leather)
    const pouch = addMesh(clothing, 'Younger guard small belt pouch', new THREE.SphereGeometry(1, 20, 14), leather)
    pouch.position.set(.24, .90, .14); pouch.scale.set(.067, .10, .05)
    curvedTube(holdingHand, 'Younger guard lowered unstrung bow', [[0, -.44 * scale, .13 * scale],
      [0, -.28 * scale, .025 * scale], [0, 0, -.05 * scale], [0, .28 * scale, .025 * scale],
      [0, .44 * scale, .13 * scale]], .014 * scale, wood)
    const grip = addMesh(holdingHand, 'Younger guard bow leather grip', new THREE.CylinderGeometry(.019 * scale, .019 * scale, .10 * scale, 12), leather)
    grip.position.z = -.045 * scale
  }
  body.userData.guardVariant = { id: variant, features, source: guardVariantSource, staticPose: true,
    originalFaceAndSkinMapsPreserved: true, wardrobeOnlyVertexTint: true, proceduralAccessories: true }
  body.updateMatrixWorld(true); rig.skeleton.update()
  return body
}
