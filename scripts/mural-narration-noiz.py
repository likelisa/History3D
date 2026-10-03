#!/usr/bin/env python3
"""Author reviewed public Noiz narration; --run explicitly enables paid API calls.

Export the 24 display cues with mural-narration-data.ts first. Raw provider audio
and request receipts stay in --work-dir outside this repository. One request per
cue, no automatic API retries; an uncertain/failed submission blocks resubmission.
Existing verified audio with identical text and provider parameters is reused.
"""
from __future__ import annotations

import argparse
import array
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
import uuid

API = 'https://noiz.ai/v1/text-to-speech'
DOCS = 'https://docs.noiz.ai/api-documentation/text-to-speech'
EXPECTED_IDS = [f'c{chapter}-{cue}' for chapter in range(8) for cue in range(3)]
VOICE_ID = '87cb2405'
PREFIX = '/mural-assets/narration-v5/'


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def stamp() -> str:
    return datetime.now(timezone.utc).isoformat()


def json_write(path: Path, value: object) -> None:
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temporary.replace(path)


def command(argv: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(argv, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)


def parameters(cue: dict, voice_id: str) -> dict:
    # Light, public guide-like delivery; no private reference or voice clone.
    emotion = {'Surprise': .35 if cue['id'] == 'c1-0' else .12}
    if cue['id'].startswith('c3-'):
        emotion = {'Sadness': .15}
    return {'text': cue['text'], 'voice_id': voice_id, 'quality_preset': '3',
            'output_format': 'mp3', 'speed': '1', 'target_lang': 'zh',
            'emo': json.dumps(emotion, separators=(',', ':')), 'trim_silence': 'true'}


def identity(params: dict) -> str:
    return sha(json.dumps(params, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf-8'))


def multipart(params: dict) -> tuple[bytes, str]:
    boundary = 'History3DNoiz' + uuid.uuid4().hex
    parts = []
    for name, value in params.items():
        parts.append((f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n').encode('utf-8'))
    parts.append(f'--{boundary}--\r\n'.encode('ascii'))
    return b''.join(parts), boundary


def inspect_audio(path: Path, encoder: str, probe: str, *, encoded: bool) -> dict:
    measured = json.loads(command([probe, '-v', 'error', '-show_entries',
        'format=duration,size:stream=codec_name,sample_rate,channels,bit_rate', '-of', 'json', str(path)]).stdout)
    streams = measured.get('streams', [])
    if len(streams) != 1 or streams[0]['codec_name'] != 'mp3':
        raise ValueError('Expected one MP3 audio stream: ' + path.name)
    stream = streams[0]
    seconds = float(measured['format']['duration'])
    if not math.isfinite(seconds) or not 0 < seconds < 180:
        raise ValueError('Invalid duration: ' + path.name)
    if encoded and (int(stream['sample_rate']) != 24000 or stream['channels'] != 1 or int(stream['bit_rate']) != 96000):
        raise ValueError('Expected 24 kHz mono 96 kbps: ' + path.name)
    decoded = array.array('f')
    decoded.frombytes(command([encoder, '-nostdin', '-hide_banner', '-loglevel', 'error', '-i', str(path),
                               '-f', 'f32le', '-acodec', 'pcm_f32le', '-']).stdout)
    if sys.byteorder != 'little':
        decoded.byteswap()
    if not decoded or any(not math.isfinite(sample) for sample in decoded):
        raise ValueError('Nonfinite or empty audio: ' + path.name)
    peak = max(abs(sample) for sample in decoded)
    clipped = sum(abs(sample) >= 1 for sample in decoded)
    if encoded and (peak >= 1 or clipped):
        raise ValueError('Decoded delivery audio clips: ' + path.name)
    if peak == 0:
        raise ValueError('Silent audio: ' + path.name)
    data = path.read_bytes()
    if int(measured['format']['size']) != len(data):
        raise ValueError('Size mismatch: ' + path.name)
    return {'seconds': seconds, 'bytes': len(data), 'sha256': sha(data), 'sampleRate': int(stream['sample_rate']),
            'channels': stream['channels'], 'decodedPeak': peak, 'clippedSamples': clipped,
            'decodedSamples': len(decoded), 'finite': True}


def encode(raw: Path, destination: Path, encoder: str) -> None:
    if destination.exists():
        raise ValueError('Unverified existing output is preserved: ' + destination.name)
    result = command([encoder, '-nostdin', '-hide_banner', '-i', str(raw), '-af',
        'loudnorm=I=-18:TP=-2:LRA=7:print_format=json', '-f', 'null', '-'])
    stderr = result.stderr.decode('utf-8', errors='replace')
    loudness, _ = json.JSONDecoder().raw_decode(stderr[stderr.rfind('{'):])
    keys = ['input_i', 'input_tp', 'input_lra', 'input_thresh', 'target_offset']
    if any(not math.isfinite(float(loudness[key])) for key in keys):
        raise ValueError('Invalid loudness measurement: ' + raw.name)
    recipe = ('loudnorm=I=-18:TP=-2:LRA=7:linear=true:'
        f'measured_I={loudness["input_i"]}:measured_TP={loudness["input_tp"]}:'
        f'measured_LRA={loudness["input_lra"]}:measured_thresh={loudness["input_thresh"]}:'
        f'offset={loudness["target_offset"]}')
    command([encoder, '-nostdin', '-hide_banner', '-loglevel', 'error', '-n', '-i', str(raw),
             '-af', recipe, '-ar', '24000', '-ac', '1', '-codec:a', 'libmp3lame', '-b:a', '96k',
             '-map_metadata', '-1', str(destination)])


def run(args: argparse.Namespace) -> dict:
    repo = Path(__file__).resolve().parent.parent
    cues_bytes = args.cues.resolve(strict=True).read_bytes()
    cues = json.loads(cues_bytes.decode('utf-8-sig'))['cues']
    if len(cues) != 24 or [cue.get('id') for cue in cues] != EXPECTED_IDS:
        raise ValueError('Expected exactly 24 ordered cues c0-0 through c7-2')
    if any(not isinstance(cue.get('text'), str) or not cue['text'].strip() or len(cue['text']) > 5000 for cue in cues):
        raise ValueError('Each cue needs nonempty exact text, <= 5000 characters')
    selected = args.only_cues or EXPECTED_IDS
    if len(set(selected)) != len(selected) or not set(selected) <= set(EXPECTED_IDS):
        raise ValueError('Invalid --only-cues')
    work, output = args.work_dir.resolve(), args.output_dir.resolve()
    if work == repo or repo in work.parents or work == output or output in work.parents or work in output.parents:
        raise ValueError('--work-dir must be outside repository and separate from output')
    if output != repo / 'viewer/public/mural-assets/narration-v5':
        raise ValueError('Only the new narration-v5 destination is supported; old versions are preserved')
    encoder, probe = shutil.which(args.ffmpeg), shutil.which(args.ffprobe)
    if not encoder or not probe:
        raise ValueError('Existing ffmpeg and ffprobe are required')
    if not args.run:
        return {'dryRun': True, 'apiCalls': 0, 'selectedCues': len(selected), 'totalCues': 24,
                'voiceId': args.voice_id, 'cuesSha256': sha(cues_bytes), 'explicitRunRequired': True,
                'requests': [{'id': cue['id'], 'parameters': parameters(cue, args.voice_id)} for cue in cues if cue['id'] in selected]}
    key = args.key_file.resolve(strict=True).read_text(encoding='utf-8').strip()
    if not key or '\n' in key or '\r' in key:
        raise ValueError('Invalid API key file')
    if args.key_file.stat().st_mode & 0o077:
        raise ValueError('API key file must be private (0600)')
    work.mkdir(parents=True, exist_ok=True)
    output.mkdir(parents=True, exist_ok=True)
    calls = 0
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    for cue in [cue for cue in cues if cue['id'] in selected]:
        params = parameters(cue, args.voice_id)
        fingerprint = identity(params)
        receipt_path = work / (cue['id'] + '.json')
        raw = work / (cue['id'] + '-provider.mp3')
        delivery = output / (cue['id'] + '.mp3')
        receipt = json.loads(receipt_path.read_text(encoding='utf-8')) if receipt_path.exists() else None
        if receipt and receipt.get('requestSha256') != fingerprint:
            raise ValueError('Existing request text/parameters differ; preserved: ' + cue['id'])
        if receipt and receipt.get('status') not in {'audio_received', 'verified'}:
            raise ValueError('Prior submission failed or outcome is uncertain; no automatic paid retry: ' + cue['id'])
        if receipt is None:
            if raw.exists() or delivery.exists():
                raise ValueError('Audio without a matching receipt is preserved: ' + cue['id'])
            receipt = {'id': cue['id'], 'text': cue['text'], 'parameters': params, 'requestSha256': fingerprint,
                       'endpoint': API, 'status': 'submitted', 'submittedAtUtc': stamp(), 'automaticRetries': 0}
            json_write(receipt_path, receipt)
            body, boundary = multipart(params)
            request = urllib.request.Request(API, data=body, method='POST', headers={
                'Authorization': key, 'Content-Type': 'multipart/form-data; boundary=' + boundary,
                'Accept': 'audio/mpeg', 'User-Agent': 'History3D-Narration-Authoring/5'})
            calls += 1
            try:
                with opener.open(request, timeout=180) as response:
                    audio = response.read()
                    safe_headers = {name: value for name, value in response.headers.items()
                                    if name.lower() in {'content-type', 'x-timestamp', 'x-audio-duration', 'x-request-id'}
                                    or name.lower().startswith(('x-usage', 'x-credit', 'x-billing'))}
                    receipt.update({'httpStatus': response.status, 'responseHeaders': safe_headers})
                # Noiz can return HTTP 200 for a JSON business error (e.g. code
                # 402). HTTP success alone is never proof of generated speech.
                content_type = next((value for name, value in safe_headers.items()
                                     if name.lower() == 'content-type'), '')
                if 'json' in content_type or audio.lstrip().startswith(b'{'):
                    try:
                        business = json.loads(audio)
                    except (ValueError, UnicodeDecodeError):
                        business = {'code': None, 'message': 'Invalid JSON API response'}
                    message = str(business.get('message', 'JSON response is not audio')).replace(key, '[redacted]')
                    response_path = work / (cue['id'] + '-response.json')
                    json_write(response_path, {'code': business.get('code'), 'message': message})
                    receipt.update({'status': 'api_rejected', 'businessCode': business.get('code'),
                                    'businessMessage': message, 'responseFile': response_path.name,
                                    'receivedAtUtc': stamp(), 'audioProduced': False})
                    json_write(receipt_path, receipt)
                    raise ValueError('API returned a business error, not audio: ' + cue['id'])
                with raw.open('xb') as stream:
                    stream.write(audio)
                receipt.update({'status': 'audio_received', 'receivedAtUtc': stamp(),
                                'rawFile': raw.name, 'rawBytes': len(audio), 'rawSha256': sha(audio)})
                json_write(receipt_path, receipt)
            except Exception as error:
                if receipt.get('status') != 'api_rejected':
                    receipt['status'] = 'call_failed_or_unknown'
                receipt.update({'failedAtUtc': stamp(), 'errorType': type(error).__name__})
                if isinstance(error, urllib.error.HTTPError):
                    receipt['httpStatus'] = error.code
                json_write(receipt_path, receipt)
                raise ValueError('API call failed/unknown; no automatic retry: ' + cue['id']) from None
        if sha(raw.read_bytes()) != receipt['rawSha256']:
            raise ValueError('Raw provider audio hash mismatch: ' + cue['id'])
        raw_validation = inspect_audio(raw, encoder, probe, encoded=False)
        if delivery.exists():
            if receipt['status'] != 'verified' or sha(delivery.read_bytes()) != receipt['delivery']['sha256']:
                raise ValueError('Unverified or changed delivery is preserved: ' + cue['id'])
        else:
            encode(raw, delivery, encoder)
        validation = inspect_audio(delivery, encoder, probe, encoded=True)
        receipt.update({'status': 'verified', 'verifiedAtUtc': stamp(), 'rawValidation': raw_validation, 'delivery': validation})
        json_write(receipt_path, receipt)
        print(json.dumps({'id': cue['id'], 'status': 'verified', 'seconds': validation['seconds'], 'apiCallsThisRun': calls}), flush=True)
    tracks = []
    for cue in cues:
        receipt_path = work / (cue['id'] + '.json')
        if not receipt_path.exists():
            continue
        receipt = json.loads(receipt_path.read_text(encoding='utf-8'))
        if receipt.get('status') != 'verified' or receipt.get('requestSha256') != identity(parameters(cue, args.voice_id)):
            continue
        result = inspect_audio(output / (cue['id'] + '.mp3'), encoder, probe, encoded=True)
        if result['sha256'] != receipt['delivery']['sha256']:
            raise ValueError('Delivery changed: ' + cue['id'])
        tracks.append({'id': cue['id'], 'text': cue['text'], 'file': PREFIX + cue['id'] + '.mp3',
                       **{name: result[name] for name in ['seconds', 'bytes', 'sha256']}})
    manifest = {'formatVersion': '5.0.0', 'voice': 'Noiz public built-in / ' + args.voice_id,
        'voiceId': args.voice_id, 'voiceDisplayName': '建国｜知识科普' if args.voice_id == VOICE_ID else args.voice_id,
        'synthesis': 'Noiz hosted text-to-speech; public built-in voice; no private recording or cloning',
        'synthesisSpeed': 1, 'sampleRate': 24000, 'provider': {'name': 'Noiz', 'endpoint': API, 'source': DOCS},
        'recordedAtUtc': stamp(), 'normalBuildSynthesizes': False, 'privateReferenceUsed': False,
        'voiceCloningUsed': False, 'textSource': 'viewer/src/mural/story.ts / chapterDefinitions', 'textUnchanged': True,
        'cuesSha256': sha(cues_bytes), 'textSourceSha256': sha((repo / 'viewer/src/mural/story.ts').read_bytes()),
        'sourceScriptSha256': sha(Path(__file__).read_bytes()), 'complete': len(tracks) == 24,
        'encoding': {'sampleRate': 24000, 'channels': 1, 'bitRate': 96000,
                     'recipe': 'two-pass loudnorm I=-18 TP=-2 LRA=7; mono libmp3lame; metadata stripped',
                     'validation': 'independent ffprobe and full FFmpeg float decode; finite samples; no delivery clipping'},
        'billing': {'creditsConsumed': None, 'note': 'No credit total inferred; API response headers retained in external authoring receipts'},
        'tracks': tracks}
    json_write(output / 'manifest.json', manifest)
    summary = {'tracks': len(tracks), 'complete': len(tracks) == 24, 'seconds': sum(track['seconds'] for track in tracks),
               'bytes': sum(track['bytes'] for track in tracks), 'apiCallsThisRun': calls, 'output': str(output)}
    json_write(work / 'verification-summary.json', summary)
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cues', type=Path, required=True)
    parser.add_argument('--output-dir', type=Path, required=True)
    parser.add_argument('--work-dir', type=Path, required=True)
    parser.add_argument('--key-file', type=Path, required=True)
    parser.add_argument('--voice-id', default=VOICE_ID)
    parser.add_argument('--ffmpeg', default='ffmpeg')
    parser.add_argument('--ffprobe', default='ffprobe')
    parser.add_argument('--only-cues', nargs='+', help='Optional subset for one controlled audition; input still contains all 24 cues')
    parser.add_argument('--run', action='store_true', help='Explicitly submit billable API requests; default is dry-run')
    args = parser.parse_args()
    try:
        print(json.dumps(run(args), ensure_ascii=False, indent=2))
    except (ValueError, OSError, KeyError, subprocess.CalledProcessError) as error:
        parser.exit(1, type(error).__name__ + ': ' + str(error) + '\n')


if __name__ == '__main__':
    main()
