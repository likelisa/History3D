#!/usr/bin/env python3
"""Explicit Qwen official-demo authoring; default is a read-only request plan.

Only the public CustomVoice preset Uncle_fu is used. No credential, reference
audio, clone API, model download or Python dependency is needed. The approved
first official-demo WAV is imported by its pinned digest. Existing requests,
receipts, source WAVs and earlier narration versions are preserved.
"""
from __future__ import annotations

import argparse
import array
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

BASE = 'https://qwen-qwen3-tts.hf.space'
CALL = BASE + '/gradio_api/call/generate_custom_voice'
MODEL = 'Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice'
SPEAKER, LANGUAGE, SIZE = 'Uncle_fu', 'Chinese', '1.7B'
STYLE = '用标准普通话，像一位沉稳、温暖的历史讲述者，语速适中，叙述自然连贯。句尾轻收，适当停顿，不用新闻播报腔，不夸张表演，不压低嗓音。'
FIRST_SHA = 'f47d4c2e50cdbc2dee165d7cd2415c5e667c9af68863127701344c20b6f73e37'
FIRST_SECONDS = 8.616875
PREFIX = '/mural-assets/narration-v9/'
IDS = [f'c{chapter}-{cue}' for chapter in range(8) for cue in range(3)]
# Copied from mural-narration-kokoro.py READINGS; 单于 is the only addition.
READINGS = {
    '张骞': ['zhang1', 'qian1'], '月氏': ['yue4', 'zhi1'],
    '大月氏': ['da4', 'yue4', 'zhi1'], '邛': ['qiong2'],
    '邛竹杖': ['qiong2', 'zhu2', 'zhang4'], '身毒': ['juan1', 'du2'],
    '旌节': ['jing1', 'jie2'], '大宛': ['da4', 'yuan1'],
    '单于': ['chan2', 'yu2'],
}
READING_SOURCES = {'身毒': 'https://dict.revised.moe.edu.tw/dictView.jsp?ID=97511'}
RECIPE = 'two-pass loudnorm I=-18 TP=-1.5 LRA=7; mono 24000Hz libmp3lame 96k; metadata stripped; FFmpeg -n'
MAX_BYTES = 64 * 1024 * 1024


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def stamp() -> str:
    return datetime.now(timezone.utc).isoformat()


def json_bytes(value: object) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode('utf-8')


def fingerprint(value: object) -> str:
    return sha(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf-8'))


def write_new(path: Path, data: bytes) -> None:
    with path.open('xb') as stream:
        stream.write(data); stream.flush(); os.fsync(stream.fileno())


def ensure_json(path: Path, value: object) -> None:
    if path.exists():
        if json.loads(path.read_text(encoding='utf-8')) != value:
            raise ValueError('Existing evidence differs and is preserved: ' + str(path))
    else:
        write_new(path, json_bytes(value))


def ensure_text(path: Path, text: str) -> None:
    data = text.encode('utf-8')
    if path.exists():
        if path.read_bytes() != data:
            raise ValueError('Existing document differs and is preserved: ' + str(path))
    else:
        write_new(path, data)


def style_for(text: str) -> tuple[str, dict]:
    # Pronunciation hints change only instruct. The data[0] product text stays
    # exactly as exported. Prefer the longer phrase instead of duplicate hints.
    terms = []
    for choices in [('大月氏', '月氏'), ('邛竹杖', '邛'), ('身毒',), ('单于',)]:
        terms.extend(next(([word] for word in choices if word in text), []))
    selected = {word: READINGS[word] for word in terms}
    hints = '；'.join(f'“{word}”读作 {" ".join(syllables)}' for word, syllables in selected.items())
    return STYLE + (' 专名读音：' + hints + '。只调整读音，不添加、删改或重复正文。' if hints else ''), selected


def request_for(cue: dict) -> dict:
    instruct, _ = style_for(cue['text'])
    return {'data': [cue['text'], LANGUAGE, SPEAKER, instruct, SIZE]}


def official_url(url: str) -> str:
    parsed = urllib.parse.urlsplit(url)
    if (parsed.scheme != 'https' or parsed.hostname != 'qwen-qwen3-tts.hf.space'
            or parsed.port not in (None, 443) or parsed.username or parsed.password or parsed.fragment):
        raise ValueError('Refused non-official Qwen file/event URL')
    return url


class OfficialRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        official_url(newurl)
        if request.get_method() != 'GET':
            raise ValueError('POST redirects are refused; no implicit second submission')
        return super().redirect_request(request, fp, code, msg, headers, newurl)


@contextmanager
def authoring_lock(evidence: Path):
    # OS locks release on process exit/crash; keep the harmless lock file so
    # manual resume needs no deletion or stale-lock override.
    with (evidence / '.authoring.lock').open('a+b') as stream:
        stream.seek(0, 2)
        if stream.tell() == 0:
            stream.write(b'0'); stream.flush()
        stream.seek(0)
        if os.name == 'nt':
            import msvcrt
            msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        try:
            yield
        finally:
            stream.seek(0)
            if os.name == 'nt':
                msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(stream.fileno(), fcntl.LOCK_UN)


class Journal:
    def __init__(self, path: Path, request_sha: str):
        self.path, self.request_sha = path, request_sha
        self.events = []
        if path.exists():
            for line in path.read_text(encoding='utf-8').splitlines():
                event = json.loads(line)
                if event.get('requestSha256') != request_sha or event.get('seq') != len(self.events):
                    raise ValueError('Invalid/mismatched append-only receipt: ' + str(path))
                self.events.append(event)

    def add(self, state: str, **fields) -> dict:
        event = {'seq': len(self.events), 'atUtc': stamp(), 'requestSha256': self.request_sha, 'state': state, **fields}
        with self.path.open('ab') as stream:
            stream.write(json_bytes(event).replace(b'\n', b'') + b'\n')
            stream.flush(); os.fsync(stream.fileno())
        self.events.append(event)
        return event

    def last(self, state: str) -> dict | None:
        return next((event for event in reversed(self.events) if event['state'] == state), None)


def command(argv: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(argv, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)


def inspect_audio(path: Path, encoder: str, probe: str, *, delivery: bool) -> dict:
    data = path.read_bytes()
    if not delivery and (data[:4] != b'RIFF' or data[8:12] != b'WAVE'):
        raise ValueError('Provider did not return a RIFF WAV: ' + path.name)
    measured = json.loads(command([probe, '-v', 'error', '-show_entries',
        'format=duration,size:stream=codec_name,sample_rate,channels,bit_rate', '-of', 'json', str(path)]).stdout)
    streams = measured.get('streams', [])
    if len(streams) != 1:
        raise ValueError('Expected exactly one audio stream: ' + path.name)
    stream = streams[0]
    if int(stream['sample_rate']) != 24000 or stream['channels'] != 1:
        raise ValueError('Expected 24kHz mono Qwen source/delivery: ' + path.name)
    if delivery and (stream['codec_name'] != 'mp3' or int(stream['bit_rate']) != 96000):
        raise ValueError('Expected mono 24kHz 96kbps MP3: ' + path.name)
    if not delivery and not stream['codec_name'].startswith('pcm_'):
        raise ValueError('Expected uncompressed official-demo WAV: ' + path.name)
    seconds = float(measured['format']['duration'])
    if not math.isfinite(seconds) or not 0 < seconds < 180 or int(measured['format']['size']) != len(data):
        raise ValueError('Invalid size/duration: ' + path.name)
    decoded = array.array('f')
    decoded.frombytes(command([encoder, '-nostdin', '-hide_banner', '-loglevel', 'error', '-xerror', '-i', str(path),
        '-f', 'f32le', '-acodec', 'pcm_f32le', '-']).stdout)
    if sys.byteorder != 'little':
        decoded.byteswap()
    if not decoded or any(not math.isfinite(sample) for sample in decoded):
        raise ValueError('Nonfinite/empty decoded audio: ' + path.name)
    peak = max(abs(sample) for sample in decoded)
    clipped = sum(abs(sample) >= 1 for sample in decoded)
    if peak == 0 or (delivery and clipped):
        raise ValueError('Silent or clipping delivery audio: ' + path.name)
    return {'bytes': len(data), 'sha256': sha(data), 'seconds': seconds, 'sampleRate': 24000, 'channels': 1,
            'decodedPeak': peak, 'clippedSamples': clipped, 'decodedSamples': len(decoded),
            'decodedSeconds': len(decoded) / 24000, 'finite': True}


def encode(wav: Path, mp3: Path, encoder: str) -> None:
    first = command([encoder, '-nostdin', '-hide_banner', '-i', str(wav), '-af',
                     'loudnorm=I=-18:TP=-1.5:LRA=7:print_format=json', '-f', 'null', '-'])
    text = first.stderr.decode('utf-8', errors='replace')
    loudness, _ = json.JSONDecoder().raw_decode(text[text.rfind('{'):])
    keys = ['input_i', 'input_tp', 'input_lra', 'input_thresh', 'target_offset']
    if any(not math.isfinite(float(loudness[key])) for key in keys):
        raise ValueError('Invalid loudness analysis: ' + wav.name)
    recipe = ('loudnorm=I=-18:TP=-1.5:LRA=7:linear=true:'
              f'measured_I={loudness["input_i"]}:measured_TP={loudness["input_tp"]}:'
              f'measured_LRA={loudness["input_lra"]}:measured_thresh={loudness["input_thresh"]}:'
              f'offset={loudness["target_offset"]}')
    command([encoder, '-nostdin', '-hide_banner', '-loglevel', 'error', '-xerror', '-n', '-i', str(wav),
             '-af', recipe, '-ar', '24000', '-ac', '1', '-codec:a', 'libmp3lame', '-b:a', '96k',
             '-map_metadata', '-1', str(mp3)])


def event_result(opener, event_id: str, receipt: Journal, evidence: Path, timeout: int) -> dict:
    url = official_url(CALL + '/' + urllib.parse.quote(event_id, safe=''))
    log = evidence / ('sse-' + uuid.uuid4().hex + '.txt')
    started = time.monotonic()
    with opener.open(urllib.request.Request(url, headers={'Accept': 'text/event-stream'}), timeout=timeout) as response, log.open('xb') as stream:
        official_url(response.geturl())
        event, lines, size = '', [], 0
        while True:
            raw = response.readline(65537)
            if not raw:
                raise ValueError('SSE closed without a complete event; known event_id preserved')
            size += len(raw)
            if len(raw) > 65536 or size > 1024 * 1024 or time.monotonic() - started > timeout:
                raise ValueError('SSE limit/timeout; known event_id preserved')
            stream.write(raw); stream.flush()
            line = raw.decode('utf-8').rstrip('\r\n')
            if line.startswith('event:'):
                event = line[6:].strip()
            elif line.startswith('data:'):
                lines.append(line[5:].lstrip())
            elif line == '' and (event or lines):
                body = '\n'.join(lines)
                if event == 'error':
                    receipt.add('generation_failed', eventId=event_id, error='SSE error', sseLog=log.name, response=body[:4000])
                    raise ValueError('Official demo returned a generation/quota error; no retry')
                if event == 'complete':
                    try:
                        value = json.loads(body)
                    except ValueError:
                        receipt.add('generation_failed', eventId=event_id, error='Invalid complete JSON', sseLog=log.name)
                        raise ValueError('Complete event was not valid JSON; no retry') from None
                    if not isinstance(value, list) or len(value) != 2 or not isinstance(value[0], dict):
                        receipt.add('generation_failed', eventId=event_id, error='Invalid complete payload', sseLog=log.name)
                        raise ValueError('Complete event did not contain [FileData, status]')
                    filedata, status = value
                    if not isinstance(status, str) or re.search(r'error|fail|quota|exceeded|失败|错误|额度', status, re.I):
                        receipt.add('generation_failed', eventId=event_id, error='Provider failure status', sseLog=log.name, status=status)
                        raise ValueError('Provider status reports generation/quota error; no retry')
                    try:
                        official_url(filedata.get('url', ''))
                    except ValueError:
                        receipt.add('generation_failed', eventId=event_id, error='Missing/non-official FileData URL', sseLog=log.name)
                        raise
                    os.fsync(stream.fileno())
                    return {'eventId': event_id, 'fileData': filedata, 'status': status, 'sseLog': log.name}
                event, lines = '', []


def obtain_wav(cue: dict, request: dict, receipt: Journal, evidence: Path, sample: Path, opener, timeout: int) -> Path:
    cue_id = cue['id']; wav = evidence / (cue_id + '.wav')
    if receipt.last('generation_failed'):
        raise ValueError('Previous generation/quota failure is preserved; no automatic retry: ' + cue_id)
    intent = receipt.last('wav_write_intent')
    if wav.exists():
        if not intent or sha(wav.read_bytes()) != intent['sha256'] or wav.stat().st_size != intent['bytes']:
            raise ValueError('Existing WAV has no matching complete write intent: ' + cue_id)
        return wav
    if intent:
        raise ValueError('WAV write was interrupted; preserve partial evidence and do not silently re-download: ' + cue_id)
    if cue_id == IDS[0]:
        data = sample.read_bytes()
        if sha(data) != FIRST_SHA:
            raise ValueError('Approved first UI sample digest changed')
        receipt.add('sample_reused', source='reviewed official public UI sample', originalSha256=FIRST_SHA,
                    originalSeconds=FIRST_SECONDS, apiSubmitted=False)
    else:
        submitted = evidence / (cue_id + '-post-response.json')
        if not submitted.exists():
            if receipt.last('post_started'):
                raise ValueError('Submission outcome is unknown; no second POST: ' + cue_id)
            receipt.add('post_started', endpoint=CALL, automaticRetries=0)
            body = json.dumps(request, ensure_ascii=False).encode('utf-8')
            try:
                with opener.open(urllib.request.Request(CALL, data=body, method='POST', headers={
                        'Content-Type': 'application/json', 'Accept': 'application/json'}), timeout=timeout) as response:
                    official_url(response.geturl())
                    answer = response.read(65537)
                if len(answer) > 65536:
                    raise ValueError('Oversized submission response')
                write_new(submitted, answer)
            except urllib.error.HTTPError as error:
                receipt.add('generation_failed', error='HTTP submission error', httpStatus=error.code, automaticRetries=0)
                raise ValueError('Official submission failed; no retry: ' + cue_id) from None
            except Exception as error:
                receipt.add('submit_unknown', errorType=type(error).__name__, automaticRetries=0)
                raise
        answer = json.loads(submitted.read_text(encoding='utf-8'))
        event_id = answer.get('event_id')
        if not isinstance(event_id, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', event_id):
            receipt.add('generation_failed', error='No valid event_id in submission response', automaticRetries=0)
            raise ValueError('Official response has no valid event_id; no retry: ' + cue_id)
        if not receipt.last('event_received'):
            receipt.add('event_received', eventId=event_id)
        complete_path = evidence / (cue_id + '-complete.json')
        if complete_path.exists():
            result = json.loads(complete_path.read_text(encoding='utf-8'))
            if result.get('eventId') != event_id:
                raise ValueError('Completed event does not match the frozen event_id')
        else:
            try:
                result = event_result(opener, event_id, receipt, evidence, timeout)
                write_new(complete_path, json_bytes(result))
            except Exception as error:
                if not receipt.last('generation_failed'):
                    state = 'generation_failed' if isinstance(error, urllib.error.HTTPError) and error.code in (402, 429) else 'event_transport_failed'
                    receipt.add(state, eventId=event_id, errorType=type(error).__name__, automaticRetries=0)
                raise
        url = official_url(result['fileData']['url'])
        if not receipt.last('event_completed'):
            receipt.add('event_completed', eventId=event_id, status=result['status'])
        try:
            with opener.open(urllib.request.Request(url), timeout=timeout) as response:
                official_url(response.geturl()); data = response.read(MAX_BYTES + 1)
            if len(data) > MAX_BYTES or data[:4] != b'RIFF' or data[8:12] != b'WAVE':
                raise ValueError('Official file is oversized or not WAV')
            declared = result['fileData'].get('size')
            if declared is not None and int(declared) != len(data):
                raise ValueError('Official FileData size does not match downloaded WAV')
        except Exception as error:
            state = 'generation_failed' if isinstance(error, urllib.error.HTTPError) and error.code in (402, 429) else 'download_transport_failed'
            receipt.add(state, eventId=event_id, errorType=type(error).__name__, automaticRetries=0)
            raise
    receipt.add('wav_write_intent', bytes=len(data), sha256=sha(data))
    write_new(wav, data)
    receipt.add('wav_saved', file=wav.name, bytes=len(data), sha256=sha(data))
    return wav


def run(args: argparse.Namespace) -> dict:
    repo = Path(__file__).resolve().parent.parent
    cues_path = args.cues.resolve(strict=True); cues_bytes = cues_path.read_bytes()
    cues = json.loads(cues_bytes.decode('utf-8-sig'))['cues']
    if [cue.get('id') for cue in cues] != IDS or any(not isinstance(cue.get('text'), str) or not cue['text'].strip() or len(cue['text']) > 5000 for cue in cues):
        raise ValueError('Expected exactly 24 ordered, nonempty reviewed cues c0-0 through c7-2')
    baseline = json.loads((repo / 'viewer/public/mural-assets/narration-v8/manifest.json').read_text(encoding='utf-8'))
    if [(cue['id'], cue['text']) for cue in cues] != [(track['id'], track['text']) for track in baseline['tracks']]:
        raise ValueError('Input text differs from the reviewed r8/v8 baseline')
    story_sha = sha((repo / 'viewer/src/mural/story.ts').read_bytes())
    if story_sha != baseline['textSourceSha256']:
        raise ValueError('Story source changed after reviewed r8 baseline')
    output, evidence = args.output.resolve(), args.evidence.resolve()
    sample = args.reuse_first_sample.resolve(strict=True)
    if output != repo / 'viewer/public/mural-assets/narration-v9':
        raise ValueError('--output must be the new narration-v9 product directory')
    if evidence == repo or repo in evidence.parents or evidence == output or output in evidence.parents or evidence in output.parents:
        raise ValueError('--evidence must be outside the repository and separate from output')
    if sample == evidence or evidence in sample.parents or sha(sample.read_bytes()) != FIRST_SHA:
        raise ValueError('Approved first sample must remain outside the new evidence directory and match its pinned SHA')
    if style_for(cues[0]['text'])[1]:
        raise ValueError('Approved first UI sample used the base style, but the current first cue needs new pronunciation hints')
    requests = [{'id': cue['id'], 'request': request_for(cue)} for cue in cues]
    identity = {'schema': 'qwen-public-narration-v9-authoring-v1', 'cuesSha256': sha(cues_bytes),
        'storySha256': story_sha, 'scriptSha256': sha(Path(__file__).read_bytes()), 'endpoint': CALL,
        'speaker': SPEAKER, 'language': LANGUAGE, 'modelSize': SIZE, 'baseStyle': STYLE,
        'encodingRecipe': RECIPE, 'reuseFirstSha256': FIRST_SHA,
        'requestsSha256': fingerprint(requests), 'automaticRetries': 0}
    if not args.run:
        return {'dryRun': True, 'networkCalls': 0, 'filesWritten': 0, 'explicitRunRequired': True,
                'identity': identity, 'reuseFirstSample': str(sample), 'maximumNewGenerationCount': 23, 'requests': requests}
    encoder, probe = shutil.which(args.ffmpeg), shutil.which(args.ffprobe)
    if not encoder or not probe:
        raise ValueError('Existing ffmpeg and ffprobe are required; nothing is installed automatically')
    if not 10 <= args.timeout <= 900:
        raise ValueError('--timeout must be between 10 and 900 seconds')
    tools = {name: command([tool, '-version']).stdout.decode('utf-8', errors='replace').splitlines()[0]
             for name, tool in [('ffmpeg', encoder), ('ffprobe', probe)]}
    runtime = {'python': sys.version.split()[0], 'client': 'Python standard-library urllib; no installed TTS package'}
    evidence.mkdir(parents=True, exist_ok=True)
    with authoring_lock(evidence):
        session_path = evidence / 'session.json'
        if session_path.exists():
            session = json.loads(session_path.read_text(encoding='utf-8'))
            if session.get('identity') != identity:
                raise ValueError('Frozen session differs; existing evidence/audio is preserved')
            if session.get('tools') != tools or session.get('runtimeVersions') != runtime:
                raise ValueError('Frozen FFmpeg/FFprobe/Python runtime differs; review before resuming')
        else:
            if any(path.name != '.authoring.lock' for path in evidence.iterdir()) or (output.exists() and any(output.iterdir())):
                raise ValueError('New run requires empty new evidence/output directories')
            session = {'identity': identity, 'createdAtUtc': stamp(), 'tools': tools, 'runtimeVersions': runtime}
            write_new(session_path, json_bytes(session))
        output.mkdir(parents=True, exist_ok=True)
        allowed = {cue_id + '.mp3' for cue_id in IDS} | {'manifest.json', 'NOTICE.md'}
        if any(path.name not in allowed or not path.is_file() for path in output.iterdir()):
            raise ValueError('Unknown file in output; no mixing or overwrite is allowed')
        opener = urllib.request.build_opener(OfficialRedirect())
        tracks, source_wavs, proof = [], [], []
        for cue in cues:
            cue_id = cue['id']; request = request_for(cue); request_sha = fingerprint(request)
            ensure_json(evidence / (cue_id + '-request.json'), {'id': cue_id, 'requestSha256': request_sha, 'endpoint': CALL, 'payload': request})
            receipt = Journal(evidence / (cue_id + '-receipt.jsonl'), request_sha)
            wav = obtain_wav(cue, request, receipt, evidence, sample, opener, args.timeout)
            raw = inspect_audio(wav, encoder, probe, delivery=False)
            if cue_id == IDS[0] and (raw['sha256'] != FIRST_SHA or abs(raw['decodedSeconds'] - FIRST_SECONDS) > .001):
                raise ValueError('Approved first sample duration/digest mismatch')
            mp3 = output / (cue_id + '.mp3')
            verified = receipt.last('verified')
            if verified and (raw['sha256'] != verified['raw']['sha256'] or not mp3.exists() or sha(mp3.read_bytes()) != verified['delivery']['sha256']):
                raise ValueError('Previously verified audio changed or disappeared: ' + cue_id)
            if mp3.exists() and not verified and not receipt.last('encode_started'):
                raise ValueError('MP3 exists without this cue encoding intent: ' + cue_id)
            if not mp3.exists():
                receipt.add('encode_started', rawSha256=raw['sha256'], recipe=RECIPE)
                encode(wav, mp3, encoder)
            delivery = inspect_audio(mp3, encoder, probe, delivery=True)
            if abs(delivery['decodedSeconds'] - raw['decodedSeconds']) > .01:
                raise ValueError('Delivery lost or added decoded audio duration: ' + cue_id)
            if verified:
                if delivery != verified['delivery'] or raw != verified['raw']:
                    raise ValueError('Previously verified probe/decode measurements changed: ' + cue_id)
            else:
                receipt.add('verified', raw=raw, delivery=delivery, text=cue['text'])
            tracks.append({'id': cue_id, 'file': PREFIX + mp3.name, 'text': cue['text'],
                           **{key: delivery[key] for key in ['seconds', 'bytes', 'sha256']}})
            source_wavs.append({'id': cue_id, 'file': wav.name, **{key: raw[key] for key in ['seconds', 'bytes', 'sha256']}})
            proof.append({'id': cue_id, 'requestSha256': request_sha, 'receipt': receipt.path.name,
                          'source': 'approved official UI sample' if cue_id == IDS[0] else 'official CustomVoice API',
                          'pronunciationHints': style_for(cue['text'])[1], 'raw': raw, 'delivery': delivery})
            print(json.dumps({'id': cue_id, 'status': 'verified', 'seconds': delivery['seconds']}, ensure_ascii=False), flush=True)
        if [track['id'] for track in tracks] != IDS:
            raise ValueError('All 24 verified tracks are required before a manifest can be written')
        manifest = {'formatVersion': '9.0.0', 'voice': 'Qwen3-TTS-12Hz-1.7B-CustomVoice / Uncle_fu (official public preset)',
            'voiceId': SPEAKER, 'voiceDisplayName': 'Uncle_fu', 'synthesis': 'official Qwen hosted CustomVoice demo; no reference recording or voice cloning',
            'synthesisSpeed': 1, 'sampleRate': 24000, 'recordedAtUtc': session['createdAtUtc'],
            'pauseSeconds': {'sentence': None, 'clause': None, 'control': 'natural provider pauses via frozen style; no added silence'},
            'normalBuildSynthesizes': False, 'privateReferenceUsed': False, 'voiceCloningUsed': False, 'modelArtifactsOutsideRepo': True,
            'textSource': 'viewer/src/mural/story.ts / chapterDefinitions', 'textStrict': True, 'textUnchanged': True,
            'textSourceSha256': story_sha, 'cuesSha256': sha(cues_bytes), 'sourceScriptSha256': identity['scriptSha256'],
            'packageLockSha256': None, 'runtimeVersions': session['runtimeVersions'],
            'provider': {'name': 'Qwen official Hugging Face demo', 'endpoint': CALL, 'source': 'https://huggingface.co/spaces/Qwen/Qwen3-TTS',
                         'modelSize': SIZE, 'language': LANGUAGE, 'automaticRetries': 0, 'hostedModelRevisionPinned': False},
            'model': {'repo': MODEL, 'revision': None, 'license': 'Apache-2.0', 'source': 'https://huggingface.co/' + MODEL,
                      'modelCard': 'https://huggingface.co/' + MODEL + '/blob/main/README.md', 'weightsIncludedInDelivery': False,
                      'modelArtifactsOutsideRepo': True, 'hostedRuntime': True},
            'styleInstruction': STYLE, 'pronunciation': READINGS, 'pronunciationSources': READING_SOURCES,
            'pronunciationControl': 'cue-specific style instructions only; acoustic pronunciation still requires audition',
            'selectedCueIds': IDS, 'chunking': {'boundary': 'one exact reviewed cue per request', 'textJoinedExactly': True, 'truncationAllowed': False},
            'encoding': {'recipe': RECIPE, 'sampleRate': 24000, 'channels': 1, 'bitRate': 96000,
                         'tools': session['tools'], 'sourceWavs': source_wavs,
                         'validation': 'ffprobe plus complete finite FFmpeg float decode; no clipping; decoded source/delivery duration within 0.01s'},
            'timing': 'visual beat, then complete measured narration and reading floor; UI playback speed adjusts voice and timeline together',
            'complete': True, 'tracks': tracks}
        notice = ('# 公开预设旁白来源\n\n这 24 轨使用 Qwen 官方 Qwen3-TTS CustomVoice 的公开预设 Uncle_fu。'
                  '未使用私人参考录音、声纹提取或音色克隆。第一轨复用用户认可的官方 demo 样本，其余轨按固定请求生成。\n\n'
                  '- 官方 demo：https://huggingface.co/spaces/Qwen/Qwen3-TTS\n'
                  '- 官方模型卡：https://huggingface.co/' + MODEL + '\n'
                  '- 模型和官方代码标注 Apache-2.0；托管 demo 的额度、排队与运行版本由服务方控制。\n'
                  '- 作者配方：scripts/mural-narration-qwen.py；每轨正文、时长与 SHA256：manifest.json。\n'
                  '- 原始 WAV、固定请求、SSE 与追加式收据保留在产品目录之外；未下载或交付权重。\n'
                  '- 专名读音只写入风格指令，没有替换正文；声学读音仍需人工试听。\n')
        ensure_text(output / 'NOTICE.md', notice)
        ensure_json(evidence / 'verification-summary.json', {'identity': identity, 'complete': True, 'tracks': proof})
        # Commit marker last: a failure at any earlier cue never exposes a partial
        # or mixed-provider narration manifest to the page/build.
        ensure_json(output / 'manifest.json', manifest)
        return {'complete': True, 'tracks': 24, 'output': str(output), 'evidence': str(evidence),
                'seconds': sum(track['seconds'] for track in tracks), 'reusedFirstSha256': FIRST_SHA}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cues', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--evidence', type=Path, required=True)
    parser.add_argument('--reuse-first-sample', type=Path, required=True)
    parser.add_argument('--ffmpeg', default='ffmpeg')
    parser.add_argument('--ffprobe', default='ffprobe')
    parser.add_argument('--timeout', type=int, default=600)
    parser.add_argument('--run', action='store_true', help='Explicitly submit up to 23 new public-demo generation requests; default is read-only')
    args = parser.parse_args()
    try:
        print(json.dumps(run(args), ensure_ascii=False, indent=2))
    except Exception as error:
        parser.exit(1, type(error).__name__ + ': ' + str(error) + '\n')


if __name__ == '__main__':
    main()
