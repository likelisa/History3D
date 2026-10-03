"""Frozen public local TTS + offline ASR alignment. Partial failures retain immutable attempts."""
import argparse
import difflib
import hashlib
import json
import math
import os
from pathlib import Path
import re
import struct
import sys
import urllib.error
import urllib.request
import wave

VOICE_ID = 'history3d-public-uncle-fu-r13'
REFERENCE_SHA = 'f47d4c2e50cdbc2dee165d7cd2415c5e667c9af68863127701344c20b6f73e37'
SOURCE_COMMIT = 'd7c2210da8c013e81a94bfc7b811a477c99fd506'
ASR_FILES = ['config.json', 'model.bin', 'preprocessor_config.json', 'tokenizer.json', 'vocabulary.json']
spoken = re.compile(r'[\u3400-\u9fffA-Za-z0-9]')
class VoiceUnavailable(RuntimeError):
    pass

def sha(data):
    return hashlib.sha256(data).hexdigest()

def file_sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()

def write_new(path, value):
    with path.open('x', encoding='utf-8') as handle:
        handle.write(json.dumps(value, ensure_ascii=False, indent=2) + '\n')

def confined(path, root):
    absolute = path.absolute()
    if absolute.exists() or absolute.is_symlink():
        attributes = getattr(os.lstat(absolute), 'st_file_attributes', 0)
        if absolute.is_symlink() or attributes & 0x400:
            raise RuntimeError('Output link rejected')
    if not absolute.resolve().is_relative_to(root):
        raise RuntimeError('Output path escaped')
    return absolute

def validate_track(track, cue, output, asr_manifest_sha):
    if not isinstance(track, dict) or track.get('id') != cue['id'] or track.get('text') != cue['text'] or track.get('file') != 'narration/' + cue['id'] + '.wav' or not re.fullmatch(r'[a-f0-9]{64}', track.get('sha256', '')) or track.get('subtitleAudioSha256') != track['sha256']:
        raise RuntimeError('Frozen cue conflict')
    audio_path = confined(output / (cue['id'] + '.wav'), output)
    if audio_path.stat().st_size != track.get('bytes') or file_sha(audio_path) != track['sha256']:
        raise RuntimeError('Frozen cue audio changed')
    seconds, _ = pcm_audit(audio_path)
    if not isinstance(track.get('seconds'), (int, float)) or abs(seconds - track['seconds']) > .001:
        raise RuntimeError('Frozen cue duration changed')
    end, time = 0, -1
    points = track.get('subtitlePoints')
    if not isinstance(points, list) or not points:
        raise RuntimeError('Missing cue timings')
    for point in points:
        onset, limit = point.get('seconds'), point.get('textEnd')
        if not isinstance(onset, (int, float)) or not math.isfinite(onset) or not time <= onset <= seconds or onset < 0 or type(limit) is not int or not end < limit <= len(cue['text']):
            raise RuntimeError('Invalid cue timings')
        time, end = onset, limit
    if end != len(cue['text']):
        raise RuntimeError('Incomplete cue timings')
    proof = json.loads(confined(output / (cue['id'] + '-audit-receipt.json'), output).read_text(encoding='utf-8'))
    if proof.get('audioSha256') != track['sha256'] or proof.get('textSha256') != sha(cue['text'].encode('utf-8')) or proof.get('pointsSha256') != sha(json.dumps(points, sort_keys=True).encode('utf-8')) or proof.get('asrModelManifestSha256') != asr_manifest_sha or proof.get('passed') is not True:
        raise RuntimeError('Frozen ASR evidence mismatch')
    return track

def call(endpoint, body=None):
    request = urllib.request.Request('http://127.0.0.1:9886/' + endpoint,
        data=json.dumps(body, ensure_ascii=False).encode('utf-8') if body is not None else None,
        headers={'Content-Type': 'application/json'}, method='POST' if body is not None else 'GET')
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(request, timeout=180 if body else 10) as response:
        if response.geturl() != request.full_url:
            raise RuntimeError('Redirect rejected')
        data = response.read(40 * 1024 * 1024 + 1)
        if len(data) > 40 * 1024 * 1024:
            raise RuntimeError('Oversized response')
        return data, response.headers

def pcm_audit(path):
    with wave.open(str(path), 'rb') as reader:
        if reader.getnchannels() != 1 or reader.getsampwidth() != 2:
            raise RuntimeError('Unexpected PCM format')
        rate, count = reader.getframerate(), reader.getnframes()
        data = reader.readframes(count)
    if len(data) != count * 2 or not 16000 <= rate <= 96000 or not .3 <= count / rate <= 180:
        raise RuntimeError('Invalid audio length')
    samples = struct.unpack('<' + 'h' * count, data)
    peak = max(abs(n) for n in samples)
    if peak < 100 or math.sqrt(sum(n * n for n in samples) / count) < 16:
        raise RuntimeError('Silent audio')
    step, quiet_start, silences = max(1, int(rate * .02)), None, []
    for offset in range(0, count, step):
        window = samples[offset:offset + step]
        quiet = math.sqrt(sum(n * n for n in window) / len(window)) < 327.68
        if quiet and quiet_start is None:
            quiet_start = offset / rate
        elif not quiet and quiet_start is not None:
            if offset / rate - quiet_start >= .5:
                silences.append({'start': quiet_start, 'end': offset / rate})
            quiet_start = None
    if quiet_start is not None and count / rate - quiet_start >= .5:
        silences.append({'start': quiet_start, 'end': count / rate})
    if any(item['end'] - item['start'] > 1.5 for item in silences):
        raise RuntimeError('Long silence requires review')
    return count / rate, silences

def align(text, words, seconds, silences):
    actual, times = [], []
    for word in words:
        chars = [c for c in word['word'] if spoken.fullmatch(c)]
        duration = max(.01, word['end'] - word['start'])
        for i, char in enumerate(chars):
            actual.append(char); times.append(max(0, word['start'] + duration * i / len(chars)))
    original = [(i, char) for i, char in enumerate(text) if spoken.fullmatch(char)]
    matcher = difflib.SequenceMatcher(None, ''.join(c for _, c in original), ''.join(actual), autojunk=False)
    operations = matcher.get_opcodes()
    if not original or matcher.ratio() < .82 or len(actual) < len(original) * .9 or any(kind == 'delete' and i2 - i1 > 3 for kind, i1, i2, _, _ in operations):
        raise RuntimeError('Unreliable spoken text coverage')
    matched = {}
    for kind, i1, i2, j1, j2 in operations:
        if kind == 'equal':
            for n in range(i2 - i1):
                matched[i1 + n] = times[j1 + n]
        elif kind == 'replace' and i2 > i1 and j2 > j1:
            for n in range(i2 - i1):
                matched[i1 + n] = times[min(j2 - 1, j1 + int(n * (j2 - j1) / (i2 - i1)))]
    # Interpolation may repair isolated ASR omissions, but cannot manufacture an entire clause.
    for clause in re.finditer(r'[^。！？；]+', text):
        indices = [i for i, (display_index, _) in enumerate(original) if clause.start() <= display_index < clause.end()]
        if indices and not any(i in matched for i in indices):
            raise RuntimeError('An entire spoken clause is missing')
    for i in range(len(original)):
        if i in matched:
            continue
        left = max((j for j in matched if j < i), default=None)
        right = min((j for j in matched if j > i), default=None)
        if left is None and right is None:
            raise RuntimeError('No timing anchors')
        if left is None:
            matched[i] = max(0, matched[right] - .08 * (right - i))
        elif right is None:
            matched[i] = min(seconds, matched[left] + .08 * (i - left))
        else:
            matched[i] = matched[left] + (matched[right] - matched[left]) * (i - left) / (right - left)
    points, last = [], 0
    for i, (display_index, _) in enumerate(original):
        onset = min(seconds, max(last, matched[i]))
        for region in silences:
            if region['start'] < onset < region['end']:
                onset = region['end']
        last = onset
        points.append({'seconds': round(last, 4), 'textEnd': original[i + 1][0] if i + 1 < len(original) else len(text)})
    return points, matcher.ratio()

def run(args):
    environment = args.environment.resolve(strict=True)
    if Path(sys.executable).resolve() != (environment / 'runtime/python.exe').resolve():
        raise RuntimeError('Use the independent public runtime')
    for key in ['HF_HUB_OFFLINE', 'HF_DATASETS_OFFLINE', 'TRANSFORMERS_OFFLINE']:
        os.environ[key] = '1'
    os.environ['HF_HOME'] = str(environment / 'cache/huggingface')
    asr_manifest = json.loads((environment / 'public-asr-manifest.json').read_text(encoding='utf-8'))
    asr_manifest_sha = file_sha(environment / 'public-asr-manifest.json')
    model_dir = environment / 'public_asr/faster-whisper-large-v3'
    if set(asr_manifest['files']) != set(ASR_FILES):
        raise RuntimeError('ASR whitelist mismatch')
    for name in ASR_FILES:
        model_file = (model_dir / name).resolve(strict=True)
        if not model_file.is_relative_to(environment) or file_sha(model_file) != asr_manifest['files'][name]:
            raise RuntimeError('Public ASR bytes changed')
    run_root = args.plan.parent.resolve(strict=True)
    plan_path = confined(args.plan, run_root)
    plan_bytes = plan_path.read_bytes()
    plan = json.loads(plan_bytes.decode('utf-8'))
    cues = [cue for chapter in plan['chapters'] for cue in chapter['cues']]
    if not 1 <= len(cues) <= 96 or len({cue['id'] for cue in cues}) != len(cues):
        raise RuntimeError('Invalid cue count')
    for cue in cues:
        if not re.fullmatch(r'[a-z][a-z0-9-]{0,47}', cue['id']) or not isinstance(cue['text'], str) or not 1 <= len(cue['text']) <= 500:
            raise RuntimeError('Invalid narration cue')
    health = json.loads(call('health')[0].decode('utf-8'))
    if health.get('status') != 'ready' or health.get('voiceId') != VOICE_ID or health.get('referenceSha256') != REFERENCE_SHA or health.get('sourceCommit') != SOURCE_COMMIT or health.get('privateReferenceUsed') is not False:
        raise VoiceUnavailable('Fixed public voice is unavailable')
    output = confined(args.output, run_root)
    if output.parent.resolve(strict=True) != run_root or output.name != 'narration':
        raise RuntimeError('Unexpected narration destination')
    output.mkdir(exist_ok=True)
    completed = confined(output / 'manifest.json', output)
    if completed.exists():
        saved = json.loads(completed.read_text(encoding='utf-8'))
        if saved.get('voiceId') != VOICE_ID or saved.get('referenceSha256') != REFERENCE_SHA or saved.get('sourceCommit') != SOURCE_COMMIT or saved.get('complete') is not True or saved.get('humanAudioReviewed') is not False or len(saved.get('tracks', [])) != len(cues):
            raise RuntimeError('Frozen narration plan changed')
        for track, cue in zip(saved['tracks'], cues):
            validate_track(track, cue, output, asr_manifest_sha)
        print(json.dumps({'complete': True, 'reused': len(cues)}), flush=True)
        return
    from faster_whisper import WhisperModel
    model = WhisperModel(str(model_dir), device='cpu', compute_type='int8', local_files_only=True, num_workers=1, cpu_threads=6)
    tracks = []
    for cue in cues:
        receipt_path = confined(output / (cue['id'] + '-receipt.json'), output)
        audio_path = confined(output / (cue['id'] + '.wav'), output)
        if receipt_path.exists():
            track = json.loads(receipt_path.read_text(encoding='utf-8'))
            validate_track(track, cue, output, asr_manifest_sha)
            tracks.append(track); continue
        evidence_dir = confined(output / 'evidence', output)
        evidence_dir.mkdir(exist_ok=True)
        folder = confined(evidence_dir / cue['id'], output)
        folder.mkdir(exist_ok=True)
        attempt = folder / ('attempt-%04d' % (1 + sum(p.is_dir() for p in folder.iterdir())))
        attempt.mkdir()
        write_new(attempt / 'intent.json', {'id': cue['id'], 'textSha256': sha(cue['text'].encode('utf-8')), 'planSha256': sha(plan_bytes), 'voiceId': VOICE_ID})
        audio, headers = call('tts', {'text': cue['text']})
        if headers.get('X-Voice-Id') != VOICE_ID or headers.get('X-Audio-Sha256') != sha(audio):
            raise RuntimeError('Voice response identity mismatch')
        candidate = attempt / 'audio.wav'
        with candidate.open('xb') as handle:
            handle.write(audio)
        seconds, silences = pcm_audit(candidate)
        segments, _ = model.transcribe(str(candidate), language='zh', beam_size=3, word_timestamps=True, vad_filter=False, condition_on_previous_text=False, initial_prompt=None, temperature=0)
        segments = list(segments)
        words = [dict(word=w.word, start=w.start, end=w.end, probability=w.probability) for segment in segments for w in segment.words or []]
        write_new(attempt / 'asr.json', {'words': words, 'silences': silences, 'humanReviewed': False})
        points, similarity = align(cue['text'], words, seconds, silences)
        track = {'id': cue['id'], 'text': cue['text'], 'file': 'narration/' + cue['id'] + '.wav', 'sha256': sha(audio), 'bytes': len(audio), 'seconds': seconds, 'subtitleAudioSha256': sha(audio), 'subtitlePoints': points}
        write_new(attempt / 'audit.json', {'audioSha256': sha(audio), 'asrSimilarity': similarity, 'method': 'offline Whisper without initial prompt; word timestamps with original-text character interpolation', 'humanReviewed': False})
        # Validated audio may have been saved just before a crash; reuse only exact bytes, never overwrite.
        if audio_path.exists():
            if file_sha(audio_path) != track['sha256']:
                raise RuntimeError('Existing cue audio requires manual reconciliation')
        else:
            with audio_path.open('xb') as handle:
                handle.write(audio)
        write_new(output / (cue['id'] + '-audit-receipt.json'), {'audioSha256': sha(audio), 'textSha256': sha(cue['text'].encode('utf-8')), 'pointsSha256': sha(json.dumps(points, sort_keys=True).encode('utf-8')), 'asrModelManifestSha256': asr_manifest_sha, 'passed': True, 'humanReviewed': False})
        write_new(receipt_path, track)
        tracks.append(track)
        print(json.dumps({'cueId': cue['id'], 'seconds': seconds, 'points': len(points), 'similarity': similarity}), flush=True)
    manifest = {'formatVersion': '1.0.0', 'voiceId': VOICE_ID, 'referenceSha256': REFERENCE_SHA, 'sourceCommit': SOURCE_COMMIT, 'complete': True, 'humanAudioReviewed': False, 'tracks': tracks}
    write_new(completed, manifest)
    print(json.dumps({'complete': True, 'tracks': len(tracks), 'humanAudioReviewed': False}), flush=True)

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    for flag in ['plan', 'output', 'environment']:
        parser.add_argument('--' + flag, type=Path, required=True)
    try:
        run(parser.parse_args())
    except urllib.error.HTTPError:
        print(json.dumps({'error': 'VOICE_FAILED'})); sys.exit(4)
    except VoiceUnavailable:
        print(json.dumps({'error': 'VOICE_UNAVAILABLE'})); sys.exit(3)
    except (urllib.error.URLError, ConnectionError, TimeoutError):
        print(json.dumps({'error': 'VOICE_UNAVAILABLE'})); sys.exit(3)
    except Exception:
        print(json.dumps({'error': 'VOICE_FAILED'})); sys.exit(4)
