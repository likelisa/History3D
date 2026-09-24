"""Validate the file handoff without interpreting historical claims."""
import json
import math
from pathlib import Path


def identifier(value):
    return isinstance(value, str) and bool(value) and all(c.isascii() and (c.isalnum() or c in '_-') for c in value)


def vector(value, positive=False):
    return (isinstance(value, list) and len(value) == 3
            and all(type(v) in (int, float) and math.isfinite(v)
                    and (not positive or v > 0) for v in value))


def validate_package(package, allow_missing_candidate=False):
    root = Path(package).resolve()
    errors, docs = [], {}
    for name in ('entities', 'scene', 'sources'):
        try:
            doc = json.loads((root / (name + '.json')).read_text(encoding='utf-8'))
            if not isinstance(doc, dict):
                raise ValueError('顶层必须是对象')
            docs[name] = doc
            if doc.get('schema_version') != 1:
                errors.append(f'{name}.json: schema_version 必须为 1')
        except (OSError, ValueError) as exc:
            errors.append(f'{name}.json: {exc}')
    if len(docs) != 3:
        return errors
    entities, scene, sources = (docs[k] for k in ('entities', 'scene', 'sources'))
    story = entities.get('story_id')
    if not identifier(story) or any(d.get('story_id') != story for d in docs.values()):
        errors.append('三个 JSON 文件必须使用同一个合法 story_id')
    if not (root / 'story.md').is_file():
        errors.append('缺少 story.md')

    def records(doc, key):
        value = doc.get(key)
        if not isinstance(value, list) or any(not isinstance(x, dict) for x in value):
            errors.append(f'{key}: 必须是对象数组')
            return []
        return value

    def ids_for(items, name):
        result = set()
        for item in items:
            value = item.get('id')
            if not identifier(value):
                errors.append(f'{name}: ID 仅允许非空 ASCII 字母数字、_、-')
            elif value in result:
                errors.append(f'{name}: ID 重复 {value}')
            else:
                result.add(value)
        return result

    def check_refs(value, context, required=False):
        if not isinstance(value, list) or any(not isinstance(x, str) for x in value):
            errors.append(f'{context}: source_ids 必须是字符串数组')
        elif (required and not value) or any(x not in source_ids for x in value):
            errors.append(f'{context}: 缺少有效来源或引用了未知 source_id')

    source_ids = ids_for(records(sources, 'sources'), 'sources')
    items = records(entities, 'entities')
    entity_ids = ids_for(items, 'entities')
    if not items:
        errors.append('entities: 至少需要一个实体')
    for item in items:
        context = str(item.get('id'))
        if item.get('evidence') not in ('recorded', 'inferred', 'demo'):
            errors.append(f'{context}: evidence 必须是 recorded/inferred/demo')
        check_refs(item.get('source_ids'), context, item.get('evidence') == 'recorded')
        if not vector(item.get('dimensions_m'), positive=True):
            errors.append(f'{context}: dimensions_m 必须是三个有限正数')
        if not isinstance(item.get('dimensions_basis'), str) or not item['dimensions_basis'].strip():
            errors.append(f'{context}: 缺少 dimensions_basis')

    for key, expected in (('units', 'meters'), ('up_axis', 'Y'), ('origin', 'model_bottom_center')):
        if scene.get(key) != expected:
            errors.append(f'scene.{key}: 必须为 {expected}')
    placed = []
    for p in records(scene, 'placements'):
        entity = p.get('entity_id')
        if not isinstance(entity, str) or entity not in entity_ids:
            errors.append('placements: 引用了未知实体')
        else:
            placed.append(entity)
        for key in ('position_m', 'rotation_rad'):
            if not vector(p.get(key)):
                errors.append(f'{entity}: {key} 必须是有限 XYZ 三数字数组')
        for key in ('asset', 'candidate_asset'):
            asset = p.get(key)
            if asset is None:
                continue
            if not isinstance(asset, str) or not asset:
                errors.append(f'{entity}: {key} 必须为空或相对文件路径')
                continue
            target = (root / asset).resolve()
            missing_allowed = allow_missing_candidate and key == 'candidate_asset' and not target.exists()
            if Path(asset).is_absolute() or not target.is_relative_to(root) or (not target.is_file() and not missing_allowed):
                errors.append(f'{entity}: {key} 资产路径无效')
    if len(placed) != len(entity_ids) or set(placed) != entity_ids:
        errors.append('每个实体恰好需要一个摆放记录')
    spawn = scene.get('spawn')
    if not isinstance(spawn, dict) or not all(vector(spawn.get(k)) for k in ('position_m', 'look_at_m')):
        errors.append('spawn: 需要有限的 position_m 和 look_at_m')
    bounds = scene.get('bounds_m')
    if not isinstance(bounds, dict) or not all(vector(bounds.get(k)) for k in ('min', 'max')):
        errors.append('bounds_m: 需要有限的 min 和 max')
    elif any(a >= b for a, b in zip(bounds['min'], bounds['max'])):
        errors.append('bounds_m: 每个 min 必须小于 max')
    points = records(scene, 'story_points')
    ids_for(points, 'story_points')
    for point in points:
        if point.get('evidence') not in ('recorded', 'inferred', 'demo'):
            errors.append('story_points: 缺少 evidence')
        check_refs(point.get('source_ids'), str(point.get('id')), point.get('evidence') == 'recorded')
        if not vector(point.get('position_m')):
            errors.append('story_points: position_m 无效')
        if point.get('entity_id') is not None and (not isinstance(point.get('entity_id'), str) or point['entity_id'] not in entity_ids):
            errors.append('story_points: 引用了未知实体')
    return errors
