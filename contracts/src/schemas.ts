import Ajv2020 from 'ajv/dist/2020.js'
import type { ErrorObject, ValidateFunction } from 'ajv'
import addFormats from 'ajv-formats'

import sceneSchema from '../schemas/scene.schema.json'
import sourcesSchema from '../schemas/sources.schema.json'
import storySchema from '../schemas/story.schema.json'

export type SchemaKey = 'story' | 'sources' | 'scene'

const schemaByKey: Record<SchemaKey, object> = {
  story: storySchema,
  sources: sourcesSchema,
  scene: sceneSchema,
}

let validatorByKey: Record<SchemaKey, ValidateFunction> | null = null

function validators(): Record<SchemaKey, ValidateFunction> {
  if (validatorByKey) return validatorByKey
  const ajv = new Ajv2020({
    allErrors: true,
    strict: false,
    allowUnionTypes: true,
  })
  addFormats(ajv)
  validatorByKey = {
    story: ajv.compile(schemaByKey.story),
    sources: ajv.compile(schemaByKey.sources),
    scene: ajv.compile(schemaByKey.scene),
  }
  return validatorByKey
}

export function schemaErrors(key: SchemaKey, data: unknown): ErrorObject[] {
  const validate = validators()[key]
  const valid = validate(data)
  return valid ? [] : (validate.errors ?? [])
}

/** `/objects/0/render/type` → `objects[0].render.type` */
export function instancePathToField(instancePath: string, missing?: string): string {
  const base = instancePath
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) => (/^\d+$/.test(segment) ? `[${segment}]` : `.${segment}`))
    .join('')
    .replace(/^\./, '')
  if (missing) return base ? `${base}.${missing}` : missing
  return base
}
