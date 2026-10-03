"""Create a fresh public-only environment; never copies the user's installed tree."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess

COMMIT = 'd7c2210da8c013e81a94bfc7b811a477c99fd506'
PREFIX = 'GPT-SoVITS-v2pro-20250604-nvidia50'
REFERENCE_SHA = 'f47d4c2e50cdbc2dee165d7cd2415c5e667c9af68863127701344c20b6f73e37'
MODEL_FILES = [
    's1v3.ckpt', 'v2Pro/s2Gv2ProPlus.pth',
    'chinese-roberta-wwm-ext-large/config.json',
    'chinese-roberta-wwm-ext-large/pytorch_model.bin',
    'chinese-roberta-wwm-ext-large/tokenizer.json',
    'chinese-hubert-base/config.json', 'chinese-hubert-base/preprocessor_config.json',
    'chinese-hubert-base/pytorch_model.bin',
    'sv/pretrained_eres2netv2w24s4ep4.ckpt', 'fast_langdetect/lid.176.bin',
]
READING_FILES = ['bopomofo_to_pinyin_wo_tune_dict.json', 'char_bopomofo_dict.json', 'config.py', 'g2pW.onnx', 'MONOPHONIC_CHARS.txt', 'POLYPHONIC_CHARS.txt', 'version']

def sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()

def output(path, data):
    with path.open('x', encoding='utf-8') as handle:
        handle.write(json.dumps(data, ensure_ascii=False, indent=2) + '\n')

def prepare(args):
    destination = args.destination.resolve()
    if destination.exists():
        raise RuntimeError('Destination exists; refusing overwrite or cleanup')
    source = args.source.resolve(strict=True)
    revision = subprocess.check_output(['git', '-C', str(source), 'rev-parse', 'HEAD'], text=True).strip()
    if revision != COMMIT or subprocess.check_output(['git', '-C', str(source), 'status', '--porcelain'], text=True).strip():
        raise RuntimeError('Expected clean official source at the frozen commit')
    origin = subprocess.check_output(['git', '-C', str(source), 'remote', 'get-url', 'origin'], text=True).strip()
    if origin != 'https://github.com/RVC-Boss/GPT-SoVITS.git':
        raise RuntimeError('Official source origin mismatch')
    if sha(args.reference) != REFERENCE_SHA:
        raise RuntimeError('Approved public reference mismatch')
    listing = subprocess.check_output([str(args.sevenzip), 'l', '-slt', str(args.archive)], text=True, encoding='utf-8')
    expected = {PREFIX + '/GPT_SoVITS/pretrained_models/' + name for name in MODEL_FILES}
    expected.update(PREFIX + '/GPT_SoVITS/text/G2PWModel/' + name for name in READING_FILES)
    entries = []
    for line in listing.splitlines():
        if not line.startswith('Path = '):
            continue
        name = line[7:].replace('\\', '/')
        if name in expected or name.startswith(PREFIX + '/runtime/'):
            if '..' in name.split('/') or ':' in name or name.startswith('/'):
                raise RuntimeError('Unsafe archive path')
            entries.append(name)
    if not expected.issubset(entries) or not any(name.endswith('/runtime/python.exe') for name in entries):
        raise RuntimeError('Archive does not contain the complete public runtime/model whitelist')
    for block in listing.split('\n\n'):
        fields = dict(line.split(' = ', 1) for line in block.splitlines() if ' = ' in line)
        name = fields.get('Path', '').replace('\\', '/')
        if name in entries and (any(fields.get(key) for key in ['Symbolic Link', 'Hard Link', 'Reparse']) or 'lrwx' in fields.get('Attributes', '')):
            raise RuntimeError('Archive link entry rejected')
    tracked = subprocess.check_output(['git', '-C', str(source), 'ls-files'], text=True).splitlines()
    # Source text only. No Git history, example media, training outputs or downloaded weights.
    code = [name for name in tracked if (name.startswith(('GPT_SoVITS/', 'tools/')) and (Path(name).suffix.lower() in {'.py', '.json', '.txt', '.yaml', '.yml', '.csv', '.md', '.sh', '.rep', '.pickle'} or Path(name).name.upper().startswith(('LICENSE', 'NOTICE', 'COPYING')))) or name in {'LICENSE', 'requirements.txt', 'extra-req.txt'}]
    code = [name for name in code if not name.startswith('GPT_SoVITS/pretrained_models/')]
    destination.mkdir(parents=True)
    include = destination / 'archive-whitelist.txt'
    include.write_text('\n'.join(entries) + '\n', encoding='utf-8')
    print(json.dumps({'phase': 'extract-public-whitelist', 'archiveEntries': len(entries), 'sourceFiles': len(code), 'privateInstalledTreeCopied': False}), flush=True)
    with (destination / 'extraction.log').open('x', encoding='utf-8') as log:
        result = subprocess.run([str(args.sevenzip), 'x', str(args.archive), '-o' + str(destination), '-i@' + str(include), '-y'], stdout=log, stderr=subprocess.STDOUT)
    if result.returncode:
        raise RuntimeError('Public extraction failed; preserve the log and partial directory')
    environment = destination / PREFIX
    for name in entries:
        extracted = (destination / name).resolve(strict=True)
        if not extracted.is_relative_to(environment.resolve()):
            raise RuntimeError('Extracted file outside the new environment')
    for name in code:
        target = environment / name
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists():
            raise RuntimeError('Archive unexpectedly provided a code file')
        shutil.copyfile(source / name, target)
    voice_dir = environment / 'public_voice'
    voice_dir.mkdir()
    shutil.copyfile(args.reference, voice_dir / 'reference.wav')
    shutil.copyfile(args.server, environment / 'public_voice_server.py')
    models = {name: sha(environment / 'GPT_SoVITS/pretrained_models' / name) for name in MODEL_FILES}
    reading = {name: sha(environment / 'GPT_SoVITS/text/G2PWModel' / name) for name in READING_FILES}
    receipt = {
        'schemaVersion': '1.0.0', 'voiceId': 'history3d-public-uncle-fu-r13',
        'source': {'origin': origin, 'commit': revision, 'sourceFiles': {name: sha(environment / name) for name in code}},
        'archiveSha256': sha(args.archive), 'archiveEntryCount': len(entries),
        'referenceSha256': REFERENCE_SHA, 'models': models,
        'readingResources': reading,
        'runtimePythonSha256': sha(environment / 'runtime/python.exe'),
        'serverSha256': sha(environment / 'public_voice_server.py'),
        'privacy': {'privateInstalledTreeCopied': False, 'privateRecordingIncluded': False, 'privateWeightsIncluded': False, 'credentialsIncluded': False},
        'training': False, 'modelDownloads': False, 'runtimeSmokeTested': False,
    }
    output(environment / 'public-voice-manifest.json', receipt)
    print(json.dumps({'phase': 'prepared', 'environment': str(environment), 'modelFiles': len(models), 'runtimeSmokeTested': False}), flush=True)

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    for flag in ['source', 'archive', 'sevenzip', 'reference', 'server', 'destination']:
        parser.add_argument('--' + flag, type=Path, required=True)
    prepare(parser.parse_args())
