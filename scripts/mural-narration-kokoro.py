#!/usr/bin/env python3
"""Author public narration with locally verified Kokoro artifacts, without downloads.

Export exact chapterDefinitions with mural-narration-data.ts first. Run this only
in the separately provisioned inference environment; normal builds never invoke
it. The WAV work directory must be outside the repository, and both WAV/MP3
destinations must be new. Model weights and voice vectors are never copied into
the product. No reference recording or voice cloning is used.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import importlib.metadata as metadata
import io
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import time

REPO_ID = 'hexgrad/Kokoro-82M-v1.1-zh'
REVISION = '01e7505bd6a7a2ac4975463114c3a7650a9f7218'
MODEL_SHA = 'b1d8410fa44dfb5c15471fd6c4225ea6b4e9ac7fa03c98e8bea47a9928476e2b'
VOICE_SHA = 'd2eeba86192eee269f600ca6821038034abd017532a1fe68ff7b0e86c2983b2a'
CONFIG_SHA = 'bc333efa5ce4ceff433c8c8e5d027a1eca0166001e4e4a62bea2d26ff7a46890'
RATE = 24000
SPEED = 0.92
PHONEME_CAP = 100
EXPECTED_IDS = [f'c{chapter}-{cue}' for chapter in range(8) for cue in range(3)]
READINGS = {
    '张骞': ['zhang1', 'qian1'], '月氏': ['yue4', 'zhi1'],
    '大月氏': ['da4', 'yue4', 'zhi1'], '邛': ['qiong2'],
    '邛竹杖': ['qiong2', 'zhu2', 'zhang4'], '身毒': ['juan1', 'du2'],
    '旌节': ['jing1', 'jie2'], '大宛': ['da4', 'yuan1'],
}
PRONUNCIATION_SOURCES = {
    '身毒': 'https://dict.revised.moe.edu.tw/dictView.jsp?ID=97511',
}


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def write_json(path: Path, value: object) -> None:
    with path.open('x', encoding='utf-8', newline='\n') as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write('\n')


def command_result(command: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(command, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)


def main(args: argparse.Namespace) -> dict:
    start = time.monotonic()
    public_version = getattr(args, 'public_version', 3)
    assert isinstance(public_version, int) and public_version >= 3, 'Public Kokoro version must be 3 or newer'
    public_prefix = f'/mural-assets/narration-v{public_version}/'
    repo = Path(__file__).resolve().parent.parent
    cues_path = args.cues.resolve(strict=True)
    cues_bytes = cues_path.read_bytes()
    cues = json.loads(cues_bytes.decode('utf-8'))['cues']
    assert [cue['id'] for cue in cues] == EXPECTED_IDS
    assert all(isinstance(cue['text'], str) and cue['text'].strip() for cue in cues)
    selected_ids = getattr(args, 'only_cues', None) or EXPECTED_IDS
    assert len(set(selected_ids)) == len(selected_ids) and set(selected_ids) <= set(EXPECTED_IDS)
    selected_ids = [cue_id for cue_id in EXPECTED_IDS if cue_id in selected_ids]
    cues = [cue for cue in cues if cue['id'] in selected_ids]
    story = repo / 'viewer/src/mural/story.ts'
    story_sha = digest(story.read_bytes())
    wav_dir, output = args.wav_dir.absolute(), args.output_dir.absolute()
    assert not wav_dir.exists(), 'Prior raw authoring outputs are preserved'
    if output.exists():
        assert args.resume_empty_output and output.is_dir() and not output.is_symlink() and not any(output.iterdir()), 'Prior encoded outputs are preserved'
    assert not wav_dir.resolve().is_relative_to(repo), 'Raw WAVs belong outside the product repository'
    assert output.parent.is_dir() and wav_dir.parent.is_dir()
    model_dir = args.model_dir.resolve(strict=True)
    for name, expected in [('config.json', CONFIG_SHA), ('zm_010.pt', VOICE_SHA),
                           ('kokoro-v1_1-zh.pth', MODEL_SHA)]:
        assert digest((model_dir / name).read_bytes()) == expected, name
    license_bytes = args.license_file.resolve(strict=True).read_bytes()
    assert b'Apache License' in license_bytes and b'Version 2.0' in license_bytes
    assert metadata.version('kokoro') == metadata.version('misaki') == '0.9.4'
    package_lock = repo / 'scripts/mural-narration-kokoro-requirements.lock.txt'
    assert package_lock.is_file()
    encoder, probe = shutil.which('ffmpeg'), shutil.which('ffprobe')
    assert encoder and probe, 'Existing ffmpeg/ffprobe required'
    os.environ['HF_HUB_OFFLINE'] = '1'
    os.environ['TRANSFORMERS_OFFLINE'] = '1'
    os.environ['HF_HUB_DISABLE_IMPLICIT_TOKEN'] = '1'
    os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'
    os.environ['HF_HOME'] = str(wav_dir.parent / 'hf-cache')
    os.environ['HUGGINGFACE_HUB_CACHE'] = str(wav_dir.parent / 'hf-cache/hub')
    for cache in ['TRANSFORMERS_CACHE', 'PYTORCH_PRETRAINED_BERT_CACHE', 'PYTORCH_TRANSFORMERS_CACHE']:
        os.environ.pop(cache, None)

    import jieba
    import numpy as np
    import soundfile as sf
    import torch
    from kokoro import KModel, KPipeline
    from pypinyin import Style, lazy_pinyin, load_phrases_dict, load_single_dict
    from pypinyin.contrib.tone_convert import to_tone
    assert torch.__version__ == '2.1.2+cpu'
    torch.set_num_threads(4)
    torch.manual_seed(0)
    np.random.seed(0)
    wav_dir.mkdir()
    output.mkdir(exist_ok=args.resume_empty_output)
    jieba_cache = wav_dir.parent / 'jieba-cache'
    jieba_cache.mkdir(exist_ok=True)
    jieba.dt.tmp_dir = str(jieba_cache)
    model = KModel(repo_id=REPO_ID, config=str(model_dir / 'config.json'),
                   model=str(model_dir / 'kokoro-v1_1-zh.pth')).to('cpu').eval()
    checkpoint = torch.load(str(model_dir / 'kokoro-v1_1-zh.pth'), map_location='cpu', weights_only=True)
    trained_count, identity_count = 0, 0
    for component, source in checkpoint.items():
        submodule = getattr(model, component)
        live = submodule.state_dict()
        source = {key.removeprefix('module.'): value for key, value in source.items()}
        assert not set(source) - set(live), component
        for key in set(live) - set(source):
            owner, parameter = key.rsplit('.', 1)
            assert isinstance(submodule.get_submodule(owner), torch.nn.InstanceNorm1d)
            assert parameter in ['weight', 'bias']
            target = torch.ones_like(live[key]) if parameter == 'weight' else torch.zeros_like(live[key])
            assert torch.equal(live[key], target), component + '.' + key
            identity_count += 1
        for key, value in source.items():
            assert value.shape == live[key].shape and torch.equal(value, live[key].cpu()), component + '.' + key
            trained_count += 1
    del checkpoint
    assert trained_count == 548 and identity_count == 140
    pack = torch.load(str(model_dir / 'zm_010.pt'), map_location='cpu', weights_only=True)
    assert isinstance(pack, torch.FloatTensor) and tuple(pack.shape) == (510, 1, 256)
    assert torch.isfinite(pack).all()
    pipeline = KPipeline(lang_code='z', repo_id=REPO_ID, model=model, device='cpu')
    # Pronunciation overrides affect G2P only; product text stays byte-for-byte exact.
    load_phrases_dict({word: [[to_tone(syllable)] for syllable in syllables] for word, syllables in READINGS.items() if len(word) > 1})
    load_single_dict({ord('邛'): to_tone('qiong2')})
    actual_readings = {word: lazy_pinyin(word, style=Style.TONE3) for word in READINGS}
    assert actual_readings == READINGS, actual_readings
    recorded_at = datetime.now(timezone.utc).isoformat()
    source_wavs, tracks, speech = [], [], []

    def phonemize(text: str) -> str:
        phones, _ = pipeline.g2p(text)
        assert phones and len(phones) <= 510, 'Empty or truncation-prone G2P'
        assert all(char in model.vocab for char in phones), 'Unmapped phoneme'
        return phones

    for cue in cues:
        text = cue['text']
        atoms = re.findall(r'[^，,。！？；：、]+[，,。！？；：、]*', text)
        assert ''.join(atoms) == text, 'Clause splitting changed text'
        chunks, current = [], ''
        for atom in atoms:
            candidate = current + atom
            if current and len(phonemize(candidate)) > PHONEME_CAP:
                chunks.append(current)
                current = atom
            else:
                current = candidate
            assert len(phonemize(current)) <= PHONEME_CAP, 'Long clause needs review, never truncate'
        if current:
            chunks.append(current)
        assert ''.join(chunks) == text
        waves, chunk_evidence = [], []
        for index, chunk in enumerate(chunks):
            phones = phonemize(chunk)
            result = list(pipeline.generate_from_tokens(phones, voice=pack, speed=SPEED))
            assert len(result) == 1 and result[0].phonemes == phones
            wave = result[0].audio.numpy().astype(np.float32, copy=False)
            assert wave.ndim == 1 and wave.size > 0 and np.isfinite(wave).all()
            assert float(np.mean(np.abs(wave) >= 1)) < 0.001, 'Raw synthesis clipped'
            if index:
                gap = args.sentence_pause if chunks[index - 1].endswith(('。', '！', '？')) else args.clause_pause
                waves.append(np.zeros(round(gap * RATE), dtype=np.float32))
            waves.append(wave)
            chunk_evidence.append({'text': chunk, 'phonemes': phones, 'phonemeLength': len(phones),
                                   'seconds': len(wave) / RATE, 'truncated': False})
        raw = np.concatenate(waves)
        buffer = io.BytesIO()
        sf.write(buffer, raw, RATE, format='WAV', subtype='PCM_16')
        wav_bytes = buffer.getvalue()
        wav_path = wav_dir / (cue['id'] + '.wav')
        with wav_path.open('xb') as stream:
            stream.write(wav_bytes)
        wav_record = {'id': cue['id'], 'file': wav_path.name, 'bytes': len(wav_bytes),
                      'sha256': digest(wav_bytes), 'seconds': len(raw) / RATE,
                      'peak': float(np.max(np.abs(raw))),
                      'clippingFraction': float(np.mean(np.abs(raw) >= 1)), 'chunks': chunk_evidence}
        source_wavs.append(wav_record)
        measurement = command_result([encoder, '-nostdin', '-hide_banner', '-i', str(wav_path),
                                      '-af', 'loudnorm=I=-18:TP=-1.5:LRA=7:print_format=json', '-f', 'null', 'NUL'])
        stderr = measurement.stderr.decode('utf-8', errors='replace')
        # FFmpeg may emit progress/statistics after the JSON object.
        loudness, _ = json.JSONDecoder().raw_decode(stderr[stderr.rfind('{'):])
        for field in ['input_i', 'input_tp', 'input_lra', 'input_thresh', 'target_offset']:
            assert math.isfinite(float(loudness[field])), 'Invalid loudness measurement'
        filter_text = ('loudnorm=I=-18:TP=-1.5:LRA=7:linear=true:'
                       f'measured_I={loudness["input_i"]}:measured_TP={loudness["input_tp"]}:'
                       f'measured_LRA={loudness["input_lra"]}:measured_thresh={loudness["input_thresh"]}:'
                       f'offset={loudness["target_offset"]}')
        mp3_path = output / (cue['id'] + '.mp3')
        command_result([encoder, '-nostdin', '-hide_banner', '-loglevel', 'error', '-n', '-i', str(wav_path),
                        '-af', filter_text, '-ar', str(RATE), '-ac', '1', '-codec:a', 'libmp3lame',
                        '-b:a', '96k', '-map_metadata', '-1', str(mp3_path)])
        measured = json.loads(command_result([probe, '-v', 'error', '-show_entries',
                                             'format=duration,size:stream=codec_name,sample_rate,channels',
                                             '-of', 'json', str(mp3_path)]).stdout)
        stream = measured['streams'][0]
        seconds = float(measured['format']['duration'])
        assert stream['codec_name'] == 'mp3' and stream['channels'] == 1 and int(stream['sample_rate']) == RATE
        assert math.isfinite(seconds) and seconds > 5 and abs(seconds - len(raw) / RATE) < .2
        decoded_bytes = command_result([encoder, '-nostdin', '-hide_banner', '-loglevel', 'error',
                                        '-i', str(mp3_path), '-f', 'f32le', '-acodec', 'pcm_f32le', '-']).stdout
        decoded = np.frombuffer(decoded_bytes, dtype='<f4')
        assert decoded.size and np.isfinite(decoded).all() and float(np.max(np.abs(decoded))) < 1
        mp3_bytes = mp3_path.read_bytes()
        assert int(measured['format']['size']) == len(mp3_bytes)
        tracks.append({'id': cue['id'], 'file': public_prefix + mp3_path.name,
                       'seconds': seconds, 'text': text, 'bytes': len(mp3_bytes), 'sha256': digest(mp3_bytes)})
        speech.append({'id': cue['id'], 'textSha256': digest(text.encode('utf-8')),
                       'rawWav': wav_record, 'loudnessMeasurement': loudness,
                       'decodedPeak': float(np.max(np.abs(decoded))), 'decodeVerified': True,
                       'probe': measured})
        print(json.dumps({'track': cue['id'], 'chunks': len(chunks), 'seconds': seconds,
                          'bytes': len(mp3_bytes), 'decodeVerified': True}), flush=True)

    assert story_sha == digest(story.read_bytes()), 'Story changed while synthesizing'
    assert cues_bytes == cues_path.read_bytes(), 'Frozen cue export changed'
    assert len(tracks) == len(selected_ids) and [track['id'] for track in tracks] == selected_ids
    tools = {name: command_result([executable, '-version']).stdout.decode('utf-8', errors='replace').splitlines()[0]
             for name, executable in [('ffmpeg', encoder), ('ffprobe', probe)]}
    versions = {name: metadata.version(name) for name in ['kokoro', 'misaki', 'torch', 'numpy', 'soundfile',
                                                        'transformers', 'huggingface-hub', 'pypinyin', 'pypinyin-dict']}
    manifest = {'formatVersion': f'{public_version}.0.0', 'voice': 'Kokoro-82M-v1.1-zh / zm_010 (official public preset)',
                'synthesis': 'offline Kokoro; no reference recording or voice cloning',
                'synthesisSpeed': SPEED, 'sampleRate': RATE, 'recordedAtUtc': recorded_at,
                'pauseSeconds': {'sentence': args.sentence_pause, 'clause': args.clause_pause},
                'normalBuildSynthesizes': False, 'privateReferenceUsed': False, 'voiceCloningUsed': False,
                'textSource': 'viewer/src/mural/story.ts / chapterDefinitions', 'textUnchanged': True,
                'textSourceSha256': story_sha, 'cuesSha256': digest(cues_bytes),
                'sourceScriptSha256': digest(Path(__file__).read_bytes()),
                'packageLockSha256': digest(package_lock.read_bytes()), 'runtimeVersions': versions,
                'model': {'repo': REPO_ID, 'revision': REVISION, 'checkpointSha256': MODEL_SHA,
                          'configSha256': CONFIG_SHA, 'voiceFile': 'voices/zm_010.pt', 'voiceSha256': VOICE_SHA,
                          'license': 'Apache-2.0', 'source': f'https://huggingface.co/{REPO_ID}/tree/{REVISION}',
                          'modelCard': f'https://huggingface.co/{REPO_ID}/blob/{REVISION}/README.md',
                          'weightsIncludedInDelivery': False, 'trainedTensorsVerified': trained_count,
                          'identityAffineDefaultsVerified': identity_count, 'weightsOnly': True},
                'pronunciation': READINGS, 'pronunciationSources': PRONUNCIATION_SOURCES,
                'selectedCueIds': selected_ids,
                'chunking': {'boundary': 'original punctuation', 'maxPhonemes': PHONEME_CAP,
                             'textJoinedExactly': True, 'truncationAllowed': False},
                'encoding': {'recipe': 'two-pass loudnorm -18 LUFS / -1.5 dBTP / LRA 7; mono 24kHz libmp3lame 96k; metadata stripped; existing outputs refused',
                             'tools': tools, 'sourceWavs': [{key: wav[key] for key in ['id', 'file', 'bytes', 'sha256', 'seconds']} for wav in source_wavs]},
                'timing': 'visual beat, then complete measured narration and reading floor; UI playback speed adjusts voice and timeline together',
                'tracks': tracks}
    write_json(output / 'manifest.json', manifest)
    with (output / 'LICENSE-Apache-2.0.txt').open('xb') as stream:
        stream.write(license_bytes)
    with (output / 'NOTICE.md').open('x', encoding='utf-8', newline='\n') as stream:
        stream.write(f'# 公开通用旁白来源\n\n这{len(tracks)}轨使用 hexgrad/Kokoro-82M-v1.1-zh 的官方公开预设 zm_010，未使用私人参考录音或音色克隆。模型与专业中文数据的授权说明见固定版本模型卡；模型标注 Apache-2.0。交付仅含合成音轨，权重、声向量、推理环境和原始 WAV 均未附带。\n\n')
        stream.write(f'- 官方模型卡：https://huggingface.co/{REPO_ID}/blob/{REVISION}/README.md\n')
        stream.write('- 包与配方：scripts/mural-narration-kokoro.py、scripts/mural-narration-kokoro-requirements.lock.txt\n')
        stream.write('- 每句正文、时长与 SHA256：manifest.json\n- 通用许可文本：LICENSE-Apache-2.0.txt\n')
    report = {'completedAtUtc': datetime.now(timezone.utc).isoformat(), 'wallSeconds': round(time.monotonic() - start, 3),
              'tracks': speech, 'textUnchanged': True, 'baseEnvironmentNotInstalledInto': True,
              'actualReadings': actual_readings,
              'termPhonemes': {word: phonemize(word) for word in READINGS},
              'privateReferenceUsed': False, 'voiceCloningUsed': False, 'modelArtifactsOutsideRepo': True,
              'output': str(output), 'audioSeconds': sum(track['seconds'] for track in tracks),
              'audioBytes': sum(track['bytes'] for track in tracks)}
    write_json(wav_dir.parent / 'authoring-result.json', report)
    return {key: report[key] for key in ['completedAtUtc', 'wallSeconds', 'audioSeconds', 'audioBytes', 'output', 'textUnchanged']}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cues', type=Path, required=True)
    parser.add_argument('--wav-dir', type=Path, required=True)
    parser.add_argument('--output-dir', type=Path, required=True)
    parser.add_argument('--model-dir', type=Path, required=True)
    parser.add_argument('--license-file', type=Path, required=True)
    parser.add_argument('--public-version', type=int, default=3, help='Public narration version; use a new version when the text changes')
    parser.add_argument('--sentence-pause', type=float, default=.24, help='Gap between sentence-ending synthesis chunks')
    parser.add_argument('--clause-pause', type=float, default=.16, help='Gap between other synthesis chunks')
    parser.add_argument('--only-cues', nargs='+', choices=EXPECTED_IDS, help='Render only selected cues into a new staging directory; never overwrite delivered audio')
    parser.add_argument('--resume-empty-output', action='store_true', help='Only reuse a verified empty output directory after an interrupted attempt; never reuse existing audio')
    print(json.dumps(main(parser.parse_args()), ensure_ascii=False, indent=2), flush=True)
