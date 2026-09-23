import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

import { warningDiagnostic } from '../../contracts/src/diagnostics.ts'
import type { Diagnostic } from '../../contracts/src/diagnostics.ts'
import { grayBoxCenterOffset, sizeTolerance } from '../../contracts/src/geometry.ts'
import type { SceneFile, SceneObject, Vec3 } from '../../contracts/src/types.ts'

export interface LoadedAsset {
  id: string
  template: THREE.Object3D
  dimensionsM: Vec3
}

export interface WorldObject {
  definition: SceneObject
  group: THREE.Group
}

export interface World {
  root: THREE.Group
  ground: THREE.Object3D
  objects: WorldObject[]
  pickTargets: THREE.Object3D[]
  diagnostics: Diagnostic[]
}

export class WorldBuildError extends Error {
  constructor(
    message: string,
    readonly file: string,
  ) {
    super(message)
    this.name = 'WorldBuildError'
  }
}

export interface BuildWorldOptions {
  scene: SceneFile
  baseUrl: string
  onAssetProgress?: (loaded: number, total: number) => void
}

export async function buildWorld({
  scene,
  baseUrl,
  onAssetProgress,
}: BuildWorldOptions): Promise<World> {
  const root = new THREE.Group()
  const diagnostics: Diagnostic[] = []
  const objects: WorldObject[] = []
  const pickTargets: THREE.Object3D[] = []

  const size = groundSize(scene)
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshStandardMaterial({ color: 0x4a5566, roughness: 0.95, metalness: 0 }),
  )
  ground.rotation.x = -Math.PI / 2
  ground.position.y = scene.ground.y
  ground.name = 'ground'
  ground.receiveShadow = true
  root.add(ground)
  pickTargets.push(ground)

  const grid = new THREE.GridHelper(size, Math.round(size / 2), 0x64748b, 0x475569)
  grid.position.y = scene.ground.y + 0.002
  root.add(grid)

  const hemisphere = new THREE.HemisphereLight(0xcfe0f2, 0x2f3a48, 1.8)
  root.add(hemisphere)
  const sun = new THREE.DirectionalLight(0xfff2d5, 2.6)
  sun.position.set(24, 34, 18)
  root.add(sun)
  const fill = new THREE.DirectionalLight(0x8fb2ff, 0.7)
  fill.position.set(-18, 12, -22)
  root.add(fill)

  const neededAssetIds = new Set(
    scene.objects
      .filter((object) => object.render.type === 'asset')
      .map((object) => (object.render.type === 'asset' ? object.render.assetId : '')),
  )
  const assetsToLoad = scene.assets.filter((asset) => neededAssetIds.has(asset.id))
  const loader = new GLTFLoader()
  const templates = new Map<string, LoadedAsset>()
  let loadedCount = 0
  onAssetProgress?.(0, assetsToLoad.length)

  for (const asset of assetsToLoad) {
    let gltf: Awaited<ReturnType<GLTFLoader['loadAsync']>>
    try {
      gltf = await loader.loadAsync(joinPath(baseUrl, asset.path))
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new WorldBuildError(`主资产加载失败：${asset.path}（${reason}）`, asset.path)
    }

    const measured = measureObject(gltf.scene)
    for (let axis = 0; axis < 3; axis += 1) {
      const declared = asset.dimensionsM[axis]
      const actual = measured[axis]
      if (Math.abs(declared - actual) > sizeTolerance(declared)) {
        diagnostics.push(
          warningDiagnostic(
            'VALIDATION_FAILED',
            asset.path,
            `dimensionsM[${axis}]`,
            `资产 ${asset.id} 实测尺寸与声明不一致（声明 ${declared} 米，实测 ${actual.toFixed(3)} 米），已按原尺寸显示，未做自动缩放`,
          ),
        )
      }
    }
    templates.set(asset.id, { id: asset.id, template: gltf.scene, dimensionsM: measured })
    loadedCount += 1
    onAssetProgress?.(loadedCount, assetsToLoad.length)
  }

  for (const definition of scene.objects) {
    const group = new THREE.Group()
    group.name = definition.id
    group.position.set(definition.position[0], definition.position[1], definition.position[2])
    group.rotation.y = definition.rotation[1]
    group.userData.objectId = definition.id

    if (definition.render.type === 'primitive') {
      const [width, height, depth] = definition.dimensionsM
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(width, height, depth),
        new THREE.MeshStandardMaterial({ color: definition.render.color, roughness: 0.8 }),
      )
      const offset = grayBoxCenterOffset(definition.dimensionsM)
      mesh.position.set(offset[0], offset[1], offset[2])
      mesh.castShadow = true
      mesh.receiveShadow = true
      mesh.userData.objectId = definition.id
      group.add(mesh)
      pickTargets.push(mesh)
    } else {
      const asset = templates.get(definition.render.assetId)
      if (!asset) {
        throw new WorldBuildError(
          `对象 ${definition.id} 引用的资产未加载：${definition.render.assetId}`,
          'scene.json',
        )
      }
      const instance = asset.template.clone(true)
      instance.traverse((child) => {
        child.userData.objectId = definition.id
        if (child instanceof THREE.Mesh) {
          child.castShadow = true
          child.receiveShadow = true
          pickTargets.push(child)
        }
      })
      group.add(instance)
    }

    root.add(group)
    objects.push({ definition, group })
  }

  return { root, ground, objects, pickTargets, diagnostics }
}

function groundSize(scene: SceneFile): number {
  const spanX = scene.walkableBounds.max[0] - scene.walkableBounds.min[0]
  const spanZ = scene.walkableBounds.max[1] - scene.walkableBounds.min[1]
  // 地面比可行走范围大：视角可以看到边界之外，脚下位置不能离开。
  return Math.max(spanX, spanZ) + 36
}

function measureObject(object: THREE.Object3D): Vec3 {
  const box = new THREE.Box3().setFromObject(object)
  const size = new THREE.Vector3()
  box.getSize(size)
  return [size.x, size.y, size.z]
}

/** 资源一律以场景包根目录为基准解析，避免把开发者机器的绝对路径写进代码。 */
function joinPath(baseUrl: string, relPath: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${relPath.replace(/^\/+/, '')}`
}
