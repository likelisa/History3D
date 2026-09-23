import * as THREE from 'three'

import type {
  Hotspot,
  HotspotBinding,
  SceneFile,
  Vec3,
} from '../../contracts/src/types.ts'

export interface HotspotMarker {
  hotspot: Hotspot
  marker: THREE.Sprite
  anchor: Vec3
}

export function createHotspotMarkers(
  story: { hotspots: Hotspot[] },
  scene: SceneFile,
  objectGroups: Map<string, THREE.Group>,
): HotspotMarker[] {
  const bindingByHotspot = new Map<string, HotspotBinding>(
    scene.hotspotBindings.map((binding) => [binding.hotspotId, binding]),
  )
  const markers: HotspotMarker[] = []

  for (const [index, hotspot] of story.hotspots.entries()) {
    const binding = bindingByHotspot.get(hotspot.id)
    if (!binding) continue

    let anchor: Vec3
    if (binding.anchor.type === 'world') {
      anchor = [...binding.anchor.position]
    } else {
      const group = objectGroups.get(binding.anchor.objectId)
      if (!group) continue
      const offset = new THREE.Vector3(...binding.anchor.offset)
      offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), group.rotation.y)
      anchor = [
        group.position.x + offset.x,
        group.position.y + offset.y,
        group.position.z + offset.z,
      ]
    }

    const marker = createNumberSprite(index + 1)
    marker.position.set(anchor[0], anchor[1], anchor[2])
    marker.userData.hotspotId = hotspot.id
    markers.push({ hotspot, marker, anchor })
  }

  return markers
}

function createNumberSprite(order: number): THREE.Sprite {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  if (context) {
    context.beginPath()
    context.arc(size / 2, size / 2, size / 2 - 6, 0, Math.PI * 2)
    context.fillStyle = 'rgba(250, 204, 21, 0.92)'
    context.fill()
    context.lineWidth = 6
    context.strokeStyle = 'rgba(15, 23, 42, 0.9)'
    context.stroke()
    context.fillStyle = '#0f172a'
    context.font = 'bold 68px system-ui, sans-serif'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(String(order), size / 2, size / 2 + 4)
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const material = new THREE.SpriteMaterial({ map: texture, depthWrite: false })
  const sprite = new THREE.Sprite(material)
  sprite.scale.set(0.7, 0.7, 0.7)
  return sprite
}
