import * as THREE from 'three'
import type { SceneProp } from './data'

const cloth = (color: string) => new THREE.MeshStandardMaterial({ color, roughness: 1, flatShading: true })
function part(group: THREE.Group, geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number) {
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.set(x, y, z)
  mesh.castShadow = true
  group.add(mesh)
  return mesh
}
function figure(color: string) {
  const group = new THREE.Group(), fabric = cloth(color), skin = cloth('#a58c73')
  part(group, new THREE.CylinderGeometry(.21, .39, .86, 8), fabric, 0, .91, 0)
  part(group, new THREE.SphereGeometry(.16, 10, 8), skin, 0, 1.51, 0)
  part(group, new THREE.ConeGeometry(.31, .17, 8), cloth('#584c3f'), 0, 1.7, 0)
  for (const side of [-1, 1]) {
    part(group, new THREE.CylinderGeometry(.09, .11, .68, 6), fabric, side * .31, 1.02, 0).rotation.z = side * .19
    part(group, new THREE.CylinderGeometry(.12, .12, .7, 6), cloth('#4b453d'), side * .16, .34, 0)
  }
  return group
}
function packAnimal() {
  const group = new THREE.Group(), hide = cloth('#756c60')
  const body = part(group, new THREE.SphereGeometry(.67, 12, 8), hide, 0, 1.03, 0)
  body.scale.set(.7, .58, 1.35)
  part(group, new THREE.CylinderGeometry(.19, .28, .85, 8), hide, 0, 1.56, -.62).rotation.x = -.3
  part(group, new THREE.BoxGeometry(.28, .34, .34), hide, 0, 1.96, -.78)
  for (const x of [-.35, .35]) for (const z of [-.53, .52]) part(group, new THREE.CylinderGeometry(.085, .1, .88, 6), hide, x, .46, z)
  return group
}
function cargo() {
  const group = new THREE.Group(), textile = cloth('#a88351'), cord = cloth('#584c39')
  for (const side of [-1, 1]) {
    const bag = part(group, new THREE.BoxGeometry(.48, .53, .7), textile, side * .62, 1.08, .1)
    bag.rotation.z = side * .1
    part(group, new THREE.BoxGeometry(.51, .045, .73), cord, side * .62, 1.08, .1)
  }
  part(group, new THREE.BoxGeometry(.7, .26, .58), cloth('#75624a'), 0, 1.55, .1)
  return group
}
function fire() {
  const group = new THREE.Group()
  for (let i = 0; i < 7; i++) {
    const a = i * Math.PI * 2 / 7
    part(group, new THREE.DodecahedronGeometry(.22), cloth('#72665b'), Math.sin(a) * .52, .13, Math.cos(a) * .52)
  }
  for (const angle of [-.5, .5]) part(group, new THREE.CylinderGeometry(.09, .1, 1.1, 7), cloth('#594232'), 0, .18, 0).rotation.z = angle
  const flame = part(group, new THREE.ConeGeometry(.2, .7, 7), new THREE.MeshBasicMaterial({ color: '#ce8351' }), 0, .55, 0)
  flame.userData.flame = true
  return group
}
function stone() {
  const group = new THREE.Group()
  const marker = part(group, new THREE.DodecahedronGeometry(1, 0), cloth('#8e8778'), 0, .82, 0)
  marker.scale.set(.5, .88, .35)
  return group
}
export function createActors(props: SceneProp[], scene: THREE.Scene) {
  const actors = new Map<string, THREE.Group>()
  for (const prop of props) {
    let object: THREE.Group
    if (prop.kind === 'traveler') object = figure(prop.id === 'companion' ? '#786b59' : '#394c45')
    else if (prop.kind === 'pursuer') object = figure('#66534c')
    else if (prop.kind === 'animal') object = packAnimal()
    else if (prop.kind === 'cargo') object = cargo()
    else if (prop.kind === 'fire') object = fire()
    else object = stone()
    object.position.set(prop.position[0], prop.position[1], prop.position[2])
    object.userData.base = [...prop.position]
    scene.add(object)
    actors.set(prop.id, object)
  }
  return actors
}
export function poseActors(actors: Map<string, THREE.Group>, time: number, beat: number) {
  const travel = Math.min(time, 9) * .48 + Math.min(7, Math.max(0, time - 12)) * 1.45
  for (const [id, object] of actors) {
    const [x, y, z] = object.userData.base as number[]
    object.position.set(x, y, z)
    object.rotation.set(0, 0, 0)
    if (['lead_traveler', 'companion', 'pack_animal', 'goods'].includes(id)) {
      object.position.z = z - travel
      if (beat === 0 || (beat === 1 && time > 12)) object.position.y += Math.sin(time * 7 + x) * .045
      if (id === 'goods') object.rotation.z = Math.sin(time * 4) * .045
      if (beat === 1 && id === 'companion') object.rotation.y = -.6
    }
    if (id.startsWith('pursuer')) {
      object.visible = beat === 2
      if (beat === 2) object.position.z = z + Math.min(5, Math.max(0, time - 19) * .45)
    }
    if (id === 'watch_fire') object.traverse(child => {
      if (child.userData.flame) child.scale.y = 1 + Math.sin(time * 9) * .13
    })
  }
}
