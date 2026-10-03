"""Correct the two confirmed v10 defects without overwriting failed evidence."""
from pathlib import Path
import copy
import hashlib
import json
import runpy
import shutil
import subprocess
import time
import urllib.request

REPO = Path(__file__).resolve().parent.parent
ROOT = REPO.parent.parent
BASE = ROOT / 'outputs/story-r8/gpt-sovits-public-r10-v1'
EVIDENCE = BASE / 'repair-v11'
OUTPUT = REPO / 'viewer/public/mural-assets/narration-v11'
SOURCE = REPO / 'viewer/public/mural-assets/narration-v10/manifest.json'
helper = runpy.run_path(str(REPO / 'scripts/mural-narration-gpt-sovits.py'))
digest, command, wav_details, write_new = [helper[key] for key in ['digest', 'command', 'wav_details', 'write_new']]
manifest = json.loads(SOURCE.read_text(encoding='utf-8'))
audit = json.loads((BASE / 'asr-audit-v1/report.json').read_text(encoding='utf-8'))
if audit['manifestSha256'] != digest(SOURCE.read_bytes()) or audit['flaggedIds'] != ['c6-0', 'c6-1']:
    raise RuntimeError('Repair scope must match the verified two-clip failure')
if OUTPUT.exists() or EVIDENCE.exists():
    raise RuntimeError('New independent repair directories required; no repeated requests')
OUTPUT.mkdir(parents=True)
EVIDENCE.mkdir(parents=True)
updated = copy.deepcopy(manifest)
updated['formatVersion'] = '11.0.0'
updated['priorRejectedVersion'] = {'version': '10.0.0', 'manifestSha256': digest(SOURCE.read_bytes()), 'reason': 'c6-0/c6-1 incomplete speech and long silent tails'}
updated['correctionScriptSha256'] = digest(Path(__file__).read_bytes())
updated['correction'] = {'cueIds': audit['flaggedIds'], 'textSplitMethod': 'cut3', 'parallelInfer': False, 'seed': 24680}
updated['validationStatus'] = 'candidate-awaiting-full-silence-and-asr-audit'
ffmpeg, ffprobe = shutil.which('ffmpeg'), shutil.which('ffprobe')
reference = BASE.parent / 'voice-r10-uncle-fu/c0-0-official-demo.wav'
if digest(reference.read_bytes()) != helper['REFERENCE_SHA']:
    raise RuntimeError('Reference mismatch')
for track in updated['tracks']:
    cue_id = track['id']
    mp3 = OUTPUT / (cue_id + '.mp3')
    if cue_id not in audit['flaggedIds']:
        old = REPO / 'viewer/public' / track['file'].lstrip('/')
        old_bytes = old.read_bytes()
        if len(old_bytes) != track['bytes'] or digest(old_bytes) != track['sha256']:
            raise RuntimeError('Verified old clip changed')
        with mp3.open('xb') as handle:
            handle.write(old_bytes)
        track['file'] = '/mural-assets/narration-v11/' + mp3.name
        continue
    text = track['text']
    for original, spoken in helper['HINTS'].items():
        text = text.replace(original, spoken)
    payload = {**helper['PARAMETERS'], 'text': text, 'prompt_text': helper['REFERENCE_TEXT'], 'ref_audio_path': reference.as_posix(), 'text_split_method': 'cut3', 'parallel_infer': False, 'seed': 24680}
    write_new(EVIDENCE / (cue_id + '-request.json'), payload)
    start = time.monotonic()
    request = urllib.request.Request('http://127.0.0.1:9885/tts', data=json.dumps(payload, ensure_ascii=False).encode('utf-8'), headers={'Content-Type': 'application/json'}, method='POST')
    with urllib.request.urlopen(request, timeout=300) as response:
        body = response.read()
        status = response.status
    if status != 200 or body[:4] != b'RIFF' or body[8:12] != b'WAVE':
        raise RuntimeError('No complete WAV returned')
    wav = EVIDENCE / (cue_id + '.wav')
    with wav.open('xb') as handle:
        handle.write(body)
    details = wav_details(wav)
    command([ffmpeg, '-nostdin', '-hide_banner', '-v', 'error', '-n', '-i', str(wav), '-ar', '32000', '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '128k', str(mp3)])
    measurement = json.loads(command([ffprobe, '-v', 'error', '-show_entries', 'format=duration,size', '-of', 'json', str(mp3)]))
    decoded = command([ffmpeg, '-nostdin', '-v', 'error', '-i', str(mp3), '-f', 's16le', '-ar', '32000', '-ac', '1', '-'])
    seconds = float(measurement['format']['duration'])
    if abs(len(decoded) / 64000 - details['seconds']) > .15 or seconds > 25:
        raise RuntimeError('Repair duration or decode remains abnormal')
    track.update({'file': '/mural-assets/narration-v11/' + mp3.name, 'seconds': seconds, 'bytes': mp3.stat().st_size, 'sha256': digest(mp3.read_bytes())})
    source_wav = {'id': cue_id, 'file': wav.name, 'sha256': digest(body), 'bytes': len(body), **details, 'synthesisText': text, 'evidenceVersion': 'repair-v11'}
    updated['sourceWavs'] = [source_wav if previous['id'] == cue_id else previous for previous in updated['sourceWavs']]
    receipt = {'id': cue_id, 'httpStatus': status, 'elapsedSeconds': time.monotonic() - start, 'sourceWav': source_wav, 'track': track, 'awaitingAsrScreening': True}
    write_new(EVIDENCE / (cue_id + '-complete.json'), receipt)
    print(json.dumps({'id': cue_id, 'seconds': seconds, 'status': 'repaired-awaiting-asr'}, ensure_ascii=False), flush=True)
if len(updated['tracks']) != 24 or len({track['sha256'] for track in updated['tracks']}) != 24:
    raise RuntimeError('Full track coverage or uniqueness mismatch')
write_new(EVIDENCE / 'candidate-manifest.json', updated)
print(json.dumps({'candidateManifest': str(EVIDENCE / 'candidate-manifest.json'), 'count': 24, 'runtimeSwitched': False}, ensure_ascii=False), flush=True)
