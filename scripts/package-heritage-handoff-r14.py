"""Offline, additive source/media/run handoff. Default: plan; --build: new ZIP + independent extraction.

No provider requests, key-document reads, installation, deletion or overwrite.
Only the public voice dependency manifests are included; weights need a separate rights-reviewed package.
"""
from __future__ import annotations
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import tempfile
import uuid
import zipfile

REPO = Path(__file__).resolve().parent.parent
VOICE_ID = 'history3d-public-uncle-fu-r13'
REFERENCE_SHA = 'f47d4c2e50cdbc2dee165d7cd2415c5e667c9af68863127701344c20b6f73e37'
SOURCE_COMMIT = 'd7c2210da8c013e81a94bfc7b811a477c99fd506'
SOURCE_ROOTS = {'agent', 'collector', 'contracts', 'processing', 'scripts', 'tests', 'docs', 'packages', 'records', 'artifacts'}
ROOT_FILES = {'package.json', 'package-lock.json', 'README.md', 'tsconfig.json', 'vite.config.ts', 'vitest.config.ts', '.gitignore', '.gitattributes', '.env.example'}
SUFFIXES = {'.ts', '.tsx', '.js', '.mjs', '.cjs', '.py', '.ps1', '.sh', '.json', '.jsonl', '.md', '.txt', '.yaml', '.yml', '.toml', '.css', '.html', '.importmap', '.svg', '.csv', '.glb', '.png', '.jpg', '.jpeg', '.webp', '.mp3', '.wav', '.m4a', '.mp4', '.webm', '.blend', '.bvh'}
EXCLUDED = {'.git', 'node_modules', '.processing-data', 'dist', 'output', 'outputs', '__pycache__', '.pytest_cache', '.cache', 'cache', 'caches', 'temp', 'tmp', 'logs', '.venv', 'venv', '.vite', 'coverage', 'sessions', 'secrets'}
REQUIRED = ['package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json', 'viewer/mural.html', 'viewer/src/mural/main.ts', 'viewer/src/mural/cinema-world.ts', 'viewer/src/mural/story.ts', 'viewer/src/mural/playback.ts', 'viewer/public/mural-assets/narration-v12/manifest.json', 'viewer/public/yuezhi/murals/full.jpg', 'viewer/public/asset-board-r8.html', 'agent/server.ts', 'agent/contracts.ts', 'agent/narration.ts', 'agent/web/index.html', 'agent/web/app.js', 'agent/web/viewer.js', 'agent/quality-policy-r14.json', 'scripts/start-heritage-agent.ps1', 'scripts/generate-public-agent-narration.py', 'scripts/public-voice-server.py']
TEXT = {'.ts', '.tsx', '.js', '.mjs', '.cjs', '.py', '.ps1', '.sh', '.json', '.jsonl', '.md', '.txt', '.yaml', '.yml', '.toml', '.css', '.html', '.importmap', '.svg', '.csv'}
SECRET_MARKERS = [
    ('provider-key', re.compile(rb'\b(?:sk|tsk)[-_][A-Za-z0-9_-]{20,}\b')),
    ('aws-key', re.compile(rb'\b(?:AKIA|ASIA)[A-Z0-9]{16}\b')),
    ('private-key', re.compile(rb'-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----')),
    ('bearer-value', re.compile(rb'(?i)\bBearer\s+[A-Za-z0-9._~+/=-]{24,}')),
    ('signed-url', re.compile(rb'(?i)[?&](?:X-Amz-Signature|X-Amz-Credential|X-Goog-Signature|AWSAccessKeyId|OSSAccessKeyId|Signature|sig)=[^\s"\x27<>]{12,}')),
    ('literal-secret', re.compile(rb'(?i)["\x27](?:api[_-]?key|access[_-]?token|client[_-]?secret|password|file[_-]?token)["\x27]\s*[:=]\s*["\x27]([A-Za-z0-9._~+/=-]{16,})["\x27]')),
]

def now(): return datetime.now(timezone.utc).isoformat()
def digest(data): return hashlib.sha256(data).hexdigest()
def write_new(file, value):
    file.parent.mkdir(parents=True, exist_ok=True)
    with file.open('x', encoding='utf-8', newline='\n') as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2); stream.write('\n')

def safe_name(name):
    value = PurePosixPath(name)
    if not name or str(value) != name or '\\' in name or value.is_absolute() or any(x in {'', '.', '..'} for x in value.parts) or re.search(r'[\x00-\x1f:<>"|?*]', name):
        raise ValueError('UNSAFE_ARCHIVE_PATH')
    if any(x.endswith((' ', '.')) or re.fullmatch(r'(?i)(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?', x) for x in value.parts):
        raise ValueError('UNSAFE_WINDOWS_PATH')
    return name.casefold()

def check_file(root, relative):
    safe_name(relative)
    source = root / relative
    for current in [source, *source.parents]:
        if current == root.parent: break
        info = current.lstat()
        if stat.S_ISLNK(info.st_mode) or getattr(info, 'st_file_attributes', 0) & 0x400:
            raise ValueError('LINK_OR_REPARSE_REJECTED')
    if not source.resolve(strict=True).is_relative_to(root.resolve(strict=True)) or not source.is_file():
        raise ValueError('FILE_OUTSIDE_ROOT')
    return source

def excluded(name):
    parts = PurePosixPath(name).parts
    lower = [x.lower() for x in parts]
    if any(x in EXCLUDED for x in lower): return True
    filename = lower[-1]
    if filename.endswith(('.log', '.pyc', '.pyo', '.tsbuildinfo', '.pem', '.key', '.pfx', '.p12', '.docx', '.blend1')): return True
    if filename.startswith('.env') and filename != '.env.example': return True
    if re.search(r'(?:api[ _.-]?keys?|secrets?|credentials)\.(?:json|txt|md|docx)$', filename): return True
    if any(x.startswith('narration-v') and x != 'narration-v12' for x in lower): return True
    if name.startswith(('viewer/public/packages/', 'collector/state/', 'collector/output/', 'collector/archive/', 'collector/candidates/')): return True
    return False

def source_allowed(name):
    if excluded(name): return False
    parts = PurePosixPath(name).parts
    if len(parts) == 1: return name in ROOT_FILES or name.upper().startswith(('LICENSE', 'NOTICE', 'COPYING'))
    if parts[0] == '.github': return Path(name).suffix in {'.yml', '.yaml'}
    if parts[0] == 'artifacts' and not name.startswith('artifacts/bronze-horse-r14/'): return False
    if parts[0] == 'viewer': return (parts[1] in {'src', 'public'} and (Path(name).suffix.lower() in SUFFIXES or parts[-1].upper().startswith(('LICENSE', 'NOTICE', 'COPYING')))) or len(parts) == 2 and Path(name).suffix in {'.html', '.ts'}
    return parts[0] in SOURCE_ROOTS and (Path(name).suffix.lower() in SUFFIXES or parts[-1].upper().startswith(('LICENSE', 'NOTICE', 'COPYING')))

def inspect(file):
    sha = hashlib.sha256(); overlap = b''; fixture_exceptions = []
    with file.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            sha.update(block); value = overlap + block
            for label, pattern in SECRET_MARKERS:
                for match in pattern.finditer(value):
                    if label == 'literal-secret' and match.group(1).lower().startswith((b'fixture-', b'fixture_', b'your_', b'example_', b'replace_')): continue
                    if label == 'signed-url' and file.name == 'mural-agent-server.test.ts' and match.group(0) == b'?signature=' + b'fixture-signed-token':
                        fixture_exceptions.append({'category':label,'fixtureValueSha256':digest(match.group(0))}); continue
                    raise ValueError('SENSITIVE_CONTENT:' + label)
            overlap = value[-8192:]
    result = {'bytes': file.stat().st_size, 'sha256': sha.hexdigest()}
    if fixture_exceptions: result['verifiedFixtureExceptions'] = [{**x,'sourceSha256':result['sha256']} for x in fixture_exceptions]
    return result

def hash_file(file):
    sha = hashlib.sha256()
    with file.open('rb') as stream:
        for block in iter(lambda:stream.read(1024*1024), b''): sha.update(block)
    return {'bytes':file.stat().st_size,'sha256':sha.hexdigest()}

def walk(root):
    for folder, dirs, files in os.walk(root, followlinks=False):
        dirs[:] = sorted(x for x in dirs if x.lower() not in EXCLUDED)
        for name in sorted(files): yield (Path(folder) / name).relative_to(root).as_posix()

def collect(repo, run, package_dir, voice_root=None):
    rows = []; names = set(); skipped = []; blocked = []
    def add(root, relative, target, category):
        try:
            folded = safe_name(target)
            if folded in names: raise ValueError('DUPLICATE_ARCHIVE_PATH')
            source = check_file(root, relative); metadata = inspect(source)
            names.add(folded); rows.append({'path': target, 'category': category, **metadata, '_source': source})
        except (ValueError, OSError) as error: blocked.append({'path': target, 'reason': str(error) if str(error).startswith('SENSITIVE_CONTENT:') else str(error).split(':')[0]})
    for name in walk(repo):
        if source_allowed(name): add(repo, name, 'History3D/' + name, 'source-and-current-media')
        else: skipped.append(name)
    missing = [name for name in REQUIRED if not any(x['path'] == 'History3D/' + name for x in rows)]
    dist = repo / 'dist'
    if dist.is_dir():
        for name in walk(dist):
            if not excluded(name) and (Path(name).suffix.lower() in SUFFIXES or Path(name).name.upper().startswith(('LICENSE','NOTICE','COPYING'))):
                add(dist,name,'Demo/'+name,'current-built-desktop-demo')
    if not any(x['path']=='Demo/mural.html' for x in rows): missing.append('Demo/mural.html')
    run_id = run.name
    if not re.fullmatch(r'run-[a-f0-9-]{36}', run_id): raise ValueError('RUN_ID_REQUIRED')
    state = json.loads(check_file(run, 'state.json').read_text(encoding='utf-8'))
    if state.get('id') != run_id or state.get('status') not in {'preview_ready', 'visual_reviewed'}: raise ValueError('CURRENT_PREVIEW_REQUIRED')
    package = (run / package_dir).resolve(strict=True)
    if not package.is_relative_to(run.resolve(strict=True)): raise ValueError('PACKAGE_OUTSIDE_RUN')
    package_relative = package.relative_to(run).as_posix()
    for name in walk(package):
        if excluded(name): continue
        if not (name in {'viewer.html', 'viewer.js', 'viewer.css', 'genericviewer.importmap', 'story.json', 'scene.json', 'asset-manifest.json', 'quality-report.json', 'quality-policy.json', 'image.jpg', 'image.png'} or name.startswith(('assets/', 'vendor/', 'narration/')) and Path(name).suffix in {'.glb', '.js', '.wav', '.json'}): continue
        add(run, package_relative + '/' + name, 'artifact-preview/' + name, 'current-artifact-preview')
        add(run, package_relative + '/' + name, 'agent-data/runs/' + run_id + '/' + package_relative + '/' + name, 'recoverable-current-run-package')
    for name in walk(run):
        if name.startswith(package_relative + '/') or excluded(name): continue
        allowed = name in {'state.json', 'events.jsonl', 'image.jpg', 'image.png', 'quality-policy.json', 'planning-policy-context.json', 'model-intent.json', 'model-receipt.json', 'model-candidate.json', 'model-repair-intent.json', 'model-repair-receipt.json', 'model-repair-candidate.json', 'model-capabilities.json', 'model-repair-capabilities.json'}
        allowed |= bool(re.fullmatch(r'asset-[a-z0-9-]+-(?:intent|receipt|request|candidate|selection)\.json', name))
        allowed |= bool(re.fullmatch(r'budget-update-[a-f0-9-]+\.json', name))
        allowed |= bool(re.fullmatch(r'(?:assets/)?[a-z][a-z0-9-]*\.glb', name))
        allowed |= bool(re.fullmatch(r'narration/(?:manifest\.json|[a-z][a-z0-9-]*\.wav)', name))
        if allowed: add(run, name, 'agent-data/runs/' + run_id + '/' + name, 'recoverable-run-whitelist')
    licence = repo / 'node_modules/three/LICENSE'
    if licence.is_file(): add(repo, 'node_modules/three/LICENSE', 'artifact-preview/vendor/LICENSE-Three.txt', 'third-party-license')
    for entry in ['viewer.html', 'story.json', 'scene.json', 'asset-manifest.json', 'narration/manifest.json']:
        if not any(x['path'] == 'artifact-preview/' + entry for x in rows): missing.append('artifact-preview/' + entry)
    narration = json.loads(check_file(package, 'narration/manifest.json').read_text(encoding='utf-8'))
    if narration.get('voiceId') != VOICE_ID or narration.get('referenceSha256') != REFERENCE_SHA or narration.get('complete') is not True: raise ValueError('FIXED_PUBLIC_NARRATION_REQUIRED')
    for track in narration.get('tracks', []):
        file = check_file(package, track['file'])
        observed = inspect(file)
        if observed['sha256'] != track['sha256'] or observed['bytes'] != track['bytes']: raise ValueError('NARRATION_HASH_MISMATCH')
    voice = {'status': 'weights-not-packaged-license-review-required', 'voiceId': VOICE_ID, 'referenceSha256': REFERENCE_SHA, 'sourceCommit': SOURCE_COMMIT, 'currentAudioPlayableWithoutVoiceEnvironment': True, 'officialSource': 'https://github.com/RVC-Boss/GPT-SoVITS', 'documentation': 'History3D/docs/agent/public-voice-r13.md', 'noAutomaticModelDownloads': True}
    if voice_root:
        manifest = json.loads(check_file(voice_root, 'public-voice-manifest.json').read_text(encoding='utf-8'))
        if manifest.get('voiceId') != VOICE_ID or manifest.get('referenceSha256') != REFERENCE_SHA or manifest.get('source', {}).get('commit') != SOURCE_COMMIT or manifest.get('privacy', {}).get('privateInstalledTreeCopied') is not False: raise ValueError('PUBLIC_VOICE_IDENTITY_REQUIRED')
        for name in ['public-voice-manifest.json', 'public-asr-manifest.json', 'LICENSE']:
            add(voice_root, name, 'voice-dependencies/' + name, 'public-voice-dependency-manifest-not-weights')
        voice['models'] = manifest.get('models', {}); voice['readingResources'] = manifest.get('readingResources', {})
        voice['sourceOrigin'] = manifest.get('source', {}).get('origin')
        voice['archiveSha256'] = manifest.get('archiveSha256')
    return rows, {'createdAt': now(), 'runId': run_id, 'packageDirectory': package_relative, 'sourceRequiredMissing': missing, 'blockedPaths': blocked, 'excludedFileCount': len(skipped), 'voiceEnvironment': voice, 'artifactNarrationTracks': len(narration.get('tracks', [])), 'currentOnly': True, 'oldVoicesPrivateCachesKeysAccountsExcluded': True, 'privacyScan': 'generic-key/signature/private-key patterns on every selected byte stream; no secret document read; not an assertion about every possible secret format', 'licenseBoundary': 'Project/team handoff requested by user; source attribution retained. No new blanket public redistribution rights claimed. Public voice weights/runtime omitted pending separate rights and whitelist review.', 'recordingIncluded': any(x['path'].endswith(('.mp4', '.webm')) for x in rows), 'validationScope': 'ZIP membership, independent extracted bytes, critical source entries, current narration hash; browser/whole listening/npm build are separate checks'}

def handoff_text(run_id, voice):
    return f'''# 请先阅读：完整源码与当前成果接力 r14

`History3D/` 是完整工程源码，含 lockfile、Agent、查看器、采集/整合代码、测试、质量规则和当前媒体，不是只有 Markdown。`artifact-preview/` 是铜奔马当前独立网页与真实 GLB、9轨公开旁白。`agent-data/runs/{run_id}/` 是仅含安全白名单的可恢复项目；密钥不在包里。

1. 电脑安装支持 `--use-env-proxy` 的 Node 24。在 `History3D/` 执行 `npm ci`，然后 `npm run check` 和 `npm run build`。安装依赖需要网络，构建不调用收费模型。
2. 已构建的张骞演示无需安装依赖：在交接根目录执行 `python -m http.server 5280 --bind 127.0.0.1`，打开 `http://127.0.0.1:5280/Demo/mural.html`，看板是 `/Demo/asset-board-r8.html`。如果Vite构建使用根路径资源，改在 `Demo/` 目录执行同一HTTP命令，打开 `/mural.html`。源码调试执行 `npm run dev -- --host 127.0.0.1 --port 5197`。当前正式配音在 `viewer/public/mural-assets/narration-v12/`。
3. 铜奔马已有网页不依赖 API 或声音环境：在交接根目录执行 `python -m http.server 5280 --bind 127.0.0.1`，打开 `http://127.0.0.1:5280/artifact-preview/viewer.html`。
4. 继续现有项目：以工程启动器的 `-DataDir` 指向解包的绝对 `agent-data` 目录，页面读取项目ID `{run_id}`。需要新生成时由伙伴填写自己的模型/Tripo Key；Key只留RAM，未知请求不重投。
5. 声音固定为公开合成参考 `{voice['voiceId']}`，参考SHA `{voice['referenceSha256']}`。本包已有音轨可以直接播放。独立声音运行时与权重没有混入主包；`voice-dependencies/` 保留公开依赖哈希和源码许可证。另见 `History3D/docs/agent/public-voice-r13.md`、`scripts/prepare-public-voice-environment.py`：从官方来源恢复经过许可与哈希核验的干净环境，设置 `HISTORY3D_PUBLIC_VOICE_ROOT`，不复制旧私人安装、不自动训练或下载模型。

下一步优先根据实际网页效果改故事/镜头/资产，固定男声和字幕继续绑定音频。当前Agent没有固定观察/阅读等待，场景切换直接讲；图像和3D辅助故事。质量迭代保留原raw与新候选身份，不冒充精确扫描。默认不设人为credits停止边界，仅用户主动勾选才限制；未知提交先核查。

未完成事项要接着做：全篇故事与专名听审、当前真实视觉复核、录屏、视觉看板更新。包内清单/解包哈希通过只证明文件完整，不认证这些体验。录像是否已有随包以 `HANDOFF-MANIFEST.json` 的 `recordingIncluded` 为准。`node_modules/.git/缓存/余额探针/密钥DOCX/旧私人声音` 都不交付。
'''

def verify_archive(archive, destination):
    if destination.exists(): raise ValueError('EXTRACTION_DESTINATION_EXISTS')
    destination.mkdir(parents=True)
    with zipfile.ZipFile(archive) as package:
        manifest = json.loads(package.read('HANDOFF-MANIFEST.json'))
        seen = set(); expected = {x['path']: x for x in manifest['entries']}
        for entry in package.infolist():
            key = safe_name(entry.filename)
            if key in seen or stat.S_ISLNK(entry.external_attr >> 16): raise ValueError('UNSAFE_ZIP_ENTRY')
            seen.add(key)
            target = destination / entry.filename
            target.parent.mkdir(parents=True, exist_ok=True)
            with package.open(entry) as source, target.open('xb') as output: shutil.copyfileobj(source, output, 1024 * 1024)
        unexpected = set(package.namelist()) - set(expected) - {'HANDOFF-MANIFEST.json'}
        if unexpected: raise ValueError('UNEXPECTED_ZIP_MEMBERS')
    for name, row in expected.items():
        observed = hash_file(check_file(destination, name))
        if observed['sha256'] != row['sha256'] or observed['bytes'] != row['bytes']: raise ValueError('EXTRACTED_HASH_MISMATCH')
    missing = [x for x in REQUIRED if not (destination / 'History3D' / x).is_file()]
    if not (destination/'Demo/mural.html').is_file(): missing.append('Demo/mural.html')
    if missing: raise ValueError('CRITICAL_SOURCE_MISSING')
    return {'verifiedAt': now(), 'status': 'passed', 'independentExtraction': True, 'allEntryHashesMatched': True, 'criticalSourceEntriesPresent': True, 'fileCount': len(expected) + 1, 'extractDirectory': str(destination), 'doesNotCertify': ['npm install/build', 'browser', 'listening', 'recording', 'model-weights license']}

def self_test():
    checks = 0
    for name in ['../escape', '/absolute', 'C:/escape', 'a\\b', 'a/CON.txt', 'a/../b']:
        try: safe_name(name)
        except ValueError: checks += 1
        else: raise AssertionError('Unsafe name accepted')
    assert source_allowed('agent/server.ts') and source_allowed('viewer/public/mural-assets/narration-v12/c0-0.mp3'); checks += 1
    assert not source_allowed('viewer/public/mural-assets/narration-v11/c0-0.mp3') and not source_allowed('.processing-data/runs/state.json'); checks += 1
    with tempfile.TemporaryDirectory(prefix='heritage-handoff-tests-') as directory:
        file = Path(directory) / 'fixture.bin'; file.write_bytes(b'prefix sk-' + b'A' * 40)
        try: inspect(file)
        except ValueError: checks += 1
        else: raise AssertionError('Secret bytes accepted')
        fixture = Path(directory) / 'mural-agent-server.test.ts'
        known_fixture = b'?signature=' + b'fixture-signed-token'
        fixture.write_bytes(known_fixture)
        assert inspect(fixture)['verifiedFixtureExceptions'][0]['category'] == 'signed-url'; checks += 1
        fixture.write_bytes(known_fixture + b'\n?signature=' + b'A' * 32)
        try: inspect(fixture)
        except ValueError: checks += 1
        else: raise AssertionError('Later signed value accepted after allowed fixture')
        fixture.write_bytes(b'"api_key":"fixture-aaaaaaaaaaaaaaaa"\n"api_key":"' + b'A' * 32 + b'"')
        try: inspect(fixture)
        except ValueError: checks += 1
        else: raise AssertionError('Later literal secret accepted after allowed fixture')
    print(json.dumps({'selfTest': 'passed', 'checks': checks, 'providerRequests': 0}))

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, default=REPO)
    parser.add_argument('--run-dir', type=Path)
    parser.add_argument('--package-directory', default='package')
    parser.add_argument('--voice-root', type=Path)
    parser.add_argument('--output-root', type=Path)
    parser.add_argument('--build', action='store_true')
    parser.add_argument('--self-test', action='store_true')
    args = parser.parse_args()
    if args.self_test: return self_test()
    if not args.run_dir: parser.error('--run-dir is required')
    repo, run = args.repo.resolve(strict=True), args.run_dir.resolve(strict=True)
    safe_name(args.package_directory)
    rows, metadata = collect(repo, run, args.package_directory, args.voice_root.resolve(strict=True) if args.voice_root else None)
    clean_rows = [{k: v for k, v in x.items() if k != '_source'} for x in rows]
    metadata.update({'sourceFiles': sum(x['path'].startswith('History3D/') for x in rows), 'fileCount': len(rows), 'uncompressedBytes': sum(x['bytes'] for x in rows), 'entries': clean_rows})
    if not args.build:
        print(json.dumps({k:v for k,v in metadata.items() if k != 'entries'}, ensure_ascii=False, indent=2)); return
    if metadata['sourceRequiredMissing'] or metadata['blockedPaths']: raise ValueError('HANDOFF_BLOCKED:' + json.dumps({'missing':metadata['sourceRequiredMissing'],'blocked':metadata['blockedPaths']}, ensure_ascii=False))
    if not args.output_root: parser.error('--output-root required for --build')
    destination = args.output_root.resolve() / ('attempt-' + datetime.now().strftime('%Y%m%d-%H%M%S') + '-' + uuid.uuid4().hex[:8])
    destination.mkdir(parents=True, exist_ok=False)
    if shutil.disk_usage(destination).free < metadata['uncompressedBytes'] * 2 + 256 * 1024**2: raise ValueError('INSUFFICIENT_FREE_SPACE')
    with (destination / 'github-file-list.txt').open('x', encoding='utf-8', newline='\n') as stream:
        stream.write('\n'.join(sorted(x['path'][len('History3D/'):] for x in rows if x['path'].startswith('History3D/'))) + '\n')
    print(json.dumps({'phase':'frozen-source-file-list-ready','githubFileListPath':str(destination/'github-file-list.txt'),'sourceFiles':metadata['sourceFiles'],'uncompressedBytes':metadata['uncompressedBytes']},ensure_ascii=False),flush=True)
    archive = destination / 'History3D-完整源码与当前成果-r14.zip'
    readme = handoff_text(metadata['runId'], metadata['voiceEnvironment']).encode('utf-8')
    metadata['entries'].append({'path':'请先阅读-接力说明.md','category':'handoff-instructions','bytes':len(readme),'sha256':digest(readme)})
    with zipfile.ZipFile(archive, 'x', compression=zipfile.ZIP_DEFLATED, compresslevel=1, allowZip64=True) as package:
        for row in rows:
            source = row['_source']; before = source.stat(); compress = zipfile.ZIP_STORED if source.suffix.lower() in {'.glb','.png','.jpg','.jpeg','.mp3','.mp4','.webm','.m4a'} else zipfile.ZIP_DEFLATED
            package.write(source, row['path'], compress_type=compress)
            observed = hash_file(source)
            if observed['sha256'] != row['sha256'] or observed['bytes'] != row['bytes'] or source.stat().st_mtime_ns != before.st_mtime_ns: raise ValueError('SOURCE_CHANGED_DURING_PACK')
        package.writestr('请先阅读-接力说明.md', readme)
        package.writestr('HANDOFF-MANIFEST.json', json.dumps(metadata, ensure_ascii=False, indent=2).encode('utf-8'))
    write_new(destination / 'HANDOFF-MANIFEST.json', metadata)
    verified = verify_archive(archive, destination / 'independent-extract')
    zip_metadata = hash_file(archive)
    receipt = {'createdAt':now(),'zipPath':str(archive),**zip_metadata,'fileCount':len(metadata['entries'])+1,'manifestPath':str(destination/'HANDOFF-MANIFEST.json'),'githubFileListPath':str(destination/'github-file-list.txt'),'githubFilesOver100MiB':[x['path'][len('History3D/'):] for x in rows if x['path'].startswith('History3D/') and x['bytes']>100*1024**2],'verification':verified,'providerRequests':0,'secretsDocumentRead':False,'voiceWeightsIncluded':False}
    write_new(destination / 'ZIP-VERIFICATION.json', receipt)
    print(json.dumps(receipt, ensure_ascii=False, indent=2))

if __name__ == '__main__': main()
