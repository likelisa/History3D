"""Use existing local Whisper word timestamps to align the unchanged subtitles."""
import argparse
from pathlib import Path
import difflib
import hashlib
import json
import os
import re
import time

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / 'work/History3D-story-r8/viewer/public'
parser = argparse.ArgumentParser()
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--ids', nargs='*')
parser.add_argument('--device', choices=['cpu', 'cuda'], default='cpu')
parser.add_argument('--compute-type', default='int8')
parser.add_argument('--prompt', action='store_true', help='Optional ASR prompt; disabled because repeating the transcript can omit the opening sentence')
args = parser.parse_args()
out = args.output.resolve()
out.mkdir(parents=True, exist_ok=True)
if (out / 'alignments.json').exists():
    raise RuntimeError('Use a new evidence directory; existing alignment is immutable')
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['HF_DATASETS_OFFLINE'] = '1'
os.environ['PYTHONDONTWRITEBYTECODE'] = '1'
from faster_whisper import WhisperModel
model_path = Path('E:/cc/GPT-SoVITS-v2pro-20250604-nvidia50/tools/asr/models/faster-whisper-large-v3')
if not (model_path / 'model.bin').is_file():
    raise RuntimeError('Existing local model required; no download is permitted')
model = WhisperModel(str(model_path), device=args.device, compute_type=args.compute_type, local_files_only=True, num_workers=1, cpu_threads=6)
manifest_path = PUBLIC / 'mural-assets/narration-v11/manifest.json'
source = manifest_path.read_bytes()
manifest = json.loads(source.decode('utf-8'))
spoken = re.compile(r'[\u3400-\u9fffA-Za-z0-9]')
alignments = []
for track in manifest['tracks']:
    if args.ids and track['id'] not in args.ids:
        continue
    destination = out / (track['id'] + '-words.json')
    if destination.exists():
        raise RuntimeError('Already observed clip; no overwrite')
    path = PUBLIC / track['file'].lstrip('/')
    if hashlib.sha256(path.read_bytes()).hexdigest() != track['sha256']:
        raise RuntimeError('Audio hash changed')
    started = time.monotonic()
    iterator, info = model.transcribe(str(path), language='zh', beam_size=3, word_timestamps=True, vad_filter=False,
                                      condition_on_previous_text=False, initial_prompt=track['text'] if args.prompt else None, temperature=0)
    segments = list(iterator)
    words = [dict(word=word.word, start=word.start, end=word.end, probability=word.probability)
             for segment in segments for word in segment.words or []]
    raw = {'id': track['id'], 'sha256': track['sha256'], 'expectedText': track['text'], 'words': words,
           'segments': [{'start': segment.start, 'end': segment.end, 'text': segment.text} for segment in segments],
           'elapsedSeconds': time.monotonic() - started}
    destination.write_text(json.dumps(raw, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    actual, actual_times = [], []
    for word in words:
        chars = [char for char in word['word'] if spoken.fullmatch(char)]
        duration = max(.01, word['end'] - word['start'])
        for index, char in enumerate(chars):
            actual.append(char)
            actual_times.append(max(0, word['start'] + duration * index / len(chars)))
    original = [(index, char) for index, char in enumerate(track['text']) if spoken.fullmatch(char)]
    expected = ''.join(char for _, char in original)
    recognized = ''.join(actual)
    matcher = difflib.SequenceMatcher(None, expected, recognized, autojunk=False)
    if matcher.ratio() < .82 or len(actual) < len(original) * .8:
        raise RuntimeError('Unreliable ASR word coverage: ' + track['id'])
    matched = {}
    for kind, i1, i2, j1, j2 in matcher.get_opcodes():
        if kind == 'equal':
            for offset in range(i2 - i1):
                matched[i1 + offset] = actual_times[j1 + offset]
        elif kind == 'replace' and i2 > i1 and j2 > j1:
            for offset in range(i2 - i1):
                matched[i1 + offset] = actual_times[min(j2 - 1, j1 + int(offset * (j2 - j1) / (i2 - i1)))]
    for index in range(len(original)):
        if index in matched:
            continue
        left = max((i for i in matched if i < index), default=None)
        right = min((i for i in matched if i > index), default=None)
        if left is None and right is None:
            raise RuntimeError('No timestamp anchors')
        if left is None:
            matched[index] = max(0, matched[right] - .08 * (right - index))
        elif right is None:
            matched[index] = min(track['seconds'], matched[left] + .08 * (index - left))
        else:
            matched[index] = matched[left] + (matched[right] - matched[left]) * (index - left) / (right - left)
    points = []
    last = 0
    for index, (display_index, _) in enumerate(original):
        last = min(track['seconds'], max(last, matched[index]))
        next_display = original[index + 1][0] if index + 1 < len(original) else len(track['text'])
        points.append({'seconds': round(last, 4), 'textEnd': next_display})
    alignment = {'id': track['id'], 'text': track['text'], 'audioSha256': track['sha256'],
                 'method': 'local Whisper word timestamps; character interpolation within words; original text retained',
                 'asrText': recognized, 'textSimilarity': matcher.ratio(), 'points': points,
                 'humanWordTimingReviewed': False}
    alignments.append(alignment)
    print(json.dumps({'id': track['id'], 'points': len(points), 'similarity': matcher.ratio(), 'lastOnset': points[-1]['seconds'], 'audioSeconds': track['seconds'], 'elapsedSeconds': raw['elapsedSeconds']}, ensure_ascii=False), flush=True)
result = {'formatVersion': '1.0.0', 'sourceManifestSha256': hashlib.sha256(source).hexdigest(),
          'scriptSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), 'model': 'existing local faster-whisper-large-v3 / ' + args.device + ' / ' + args.compute_type,
          'unchangedDisplayText': True, 'alignments': alignments, 'humanReviewPending': True}
(out / 'alignments.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
