"""Fixed public voice service. No reference uploads, path parameters or weight switching."""
import hashlib
import io
import json
import os
from pathlib import Path
import sys
import threading
import wave

ROOT = Path(__file__).resolve().parent
sys.dont_write_bytecode = True
os.environ['PYTHONDONTWRITEBYTECODE'] = '1'
os.chdir(ROOT)
sys.path[:0] = [str(ROOT), str(ROOT / 'GPT_SoVITS')]
for flag in ['HF_HUB_OFFLINE', 'TRANSFORMERS_OFFLINE', 'HF_DATASETS_OFFLINE']:
    os.environ[flag] = '1'
os.environ['HF_HOME'] = str(ROOT / 'cache' / 'huggingface')
os.environ['TRANSFORMERS_CACHE'] = str(ROOT / 'cache' / 'huggingface')
os.environ['TORCH_HOME'] = str(ROOT / 'cache' / 'torch')
os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'
for secret_name in ['HF_TOKEN', 'HUGGING_FACE_HUB_TOKEN']:
    os.environ.pop(secret_name, None)
os.environ['TMPDIR'] = str(ROOT / 'temp')
os.environ['TEMP'] = str(ROOT / 'temp')
os.environ['TMP'] = str(ROOT / 'temp')
(ROOT / 'temp').mkdir(exist_ok=True)

VOICE_ID = 'history3d-public-uncle-fu-r13'
REFERENCE_SHA = 'f47d4c2e50cdbc2dee165d7cd2415c5e667c9af68863127701344c20b6f73e37'
REFERENCE_TEXT = '西汉时，汉武帝想找到一个盟友，共同对抗匈奴。张骞的故事，就从这项任务开始。'

def sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()

def verify_environment():
    manifest = json.loads((ROOT / 'public-voice-manifest.json').read_text(encoding='utf-8'))
    for name in ['public_voice/reference.wav', 'public_voice_server.py', 'runtime/python.exe']:
        if not (ROOT / name).resolve(strict=True).is_relative_to(ROOT):
            raise RuntimeError('Public environment path escaped')
    if Path(sys.executable).resolve() != (ROOT / 'runtime/python.exe').resolve() or sha(Path(sys.executable)) != manifest['runtimePythonSha256']:
        raise RuntimeError('Use the independent public runtime')
    if manifest['source']['commit'] != 'd7c2210da8c013e81a94bfc7b811a477c99fd506':
        raise RuntimeError('Official source revision changed')
    if manifest['voiceId'] != VOICE_ID or manifest['referenceSha256'] != REFERENCE_SHA or sha(ROOT / 'public_voice/reference.wav') != REFERENCE_SHA:
        raise RuntimeError('Public voice identity mismatch')
    if sha(ROOT / 'public_voice_server.py') != manifest['serverSha256']:
        raise RuntimeError('Fixed voice server source changed')
    for name, expected in manifest['models'].items():
        candidate = (ROOT / 'GPT_SoVITS/pretrained_models' / name).resolve(strict=True)
        if not candidate.is_relative_to(ROOT) or sha(candidate) != expected:
            raise RuntimeError('Public model whitelist mismatch')
    for name, expected in manifest['readingResources'].items():
        candidate = (ROOT / 'GPT_SoVITS/text/G2PWModel' / name).resolve(strict=True)
        if not candidate.is_relative_to(ROOT) or sha(candidate) != expected:
            raise RuntimeError('Public reading resource mismatch')
    for name, expected in manifest['source']['sourceFiles'].items():
        candidate = (ROOT / name).resolve(strict=True)
        if not candidate.is_relative_to(ROOT) or sha(candidate) != expected:
            raise RuntimeError('Official source changed')
    if any((ROOT / name).exists() for name in ['GPT_weights', 'GPT_weights_v2ProPlus', 'SoVITS_weights', 'SoVITS_weights_v2ProPlus', 'output', 'output1', 'logs', 'weight.json']):
        raise RuntimeError('Unexpected user voice directory/config')
    return manifest

MANIFEST = verify_environment()
import numpy as np
import torch
from fastapi import FastAPI, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field
from GPT_SoVITS.TTS_infer_pack.TTS import TTS, TTS_Config

CONFIG = {'custom': {
    'device': 'cuda' if torch.cuda.is_available() else 'cpu',
    'is_half': torch.cuda.is_available(), 'version': 'v2ProPlus',
    't2s_weights_path': 'GPT_SoVITS/pretrained_models/s1v3.ckpt',
    'vits_weights_path': 'GPT_SoVITS/pretrained_models/v2Pro/s2Gv2ProPlus.pth',
    'bert_base_path': 'GPT_SoVITS/pretrained_models/chinese-roberta-wwm-ext-large',
    'cnhuhbert_base_path': 'GPT_SoVITS/pretrained_models/chinese-hubert-base',
}}
configuration = TTS_Config(CONFIG)
# GPT-SoVITS saves model configuration during initialization. Keep that runtime output
# away from the frozen official source tree and the user's previous installation.
configuration.configs_path = str(ROOT / 'public_voice/runtime-tts.yaml')
engine = TTS(configuration)
# Fail before exposing a ready endpoint if lazy Chinese text resources are incomplete.
import text.chinese2
lock = threading.Lock()
app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

class Speech(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    text: str = Field(min_length=1, max_length=500)

@app.get('/health')
def health():
    return {'status': 'ready', 'voiceId': VOICE_ID, 'referenceSha256': REFERENCE_SHA,
            'modelHashes': {name: MANIFEST['models'][name] for name in ['s1v3.ckpt', 'v2Pro/s2Gv2ProPlus.pth']},
            'privateReferenceUsed': False, 'training': False, 'sourceCommit': MANIFEST['source']['commit']}

@app.post('/tts')
def speak(request: Speech):
    text = request.text.strip()
    if not text or any(ord(c) < 32 and c not in '\n\t' for c in text):
        raise HTTPException(status_code=422, detail='Invalid narration text')
    # Only supplied narration leaves this process; the reference always remains fixed and local.
    parameters = {
        'text': text, 'text_lang': 'zh', 'prompt_lang': 'zh',
        'ref_audio_path': str(ROOT / 'public_voice/reference.wav'), 'prompt_text': REFERENCE_TEXT,
        'text_split_method': 'cut3', 'batch_size': 1, 'parallel_infer': False,
        'streaming_mode': False, 'speed_factor': 1.0, 'seed': 24680,
        'top_k': 15, 'top_p': .6, 'temperature': .6, 'repetition_penalty': 1.35,
        'super_sampling': False,
    }
    if not lock.acquire(blocking=False):
        raise HTTPException(status_code=409, detail='Voice is busy')
    try:
        pieces = list(engine.run(parameters))
        if not pieces or any(rate != pieces[0][0] for rate, _ in pieces):
            raise RuntimeError('Incomplete narration')
        rate = pieces[0][0]
        audio = np.concatenate([np.asarray(data, dtype=np.int16) for _, data in pieces])
        if audio.ndim != 1 or not 0.3 <= len(audio) / rate <= 180 or np.max(np.abs(audio.astype(np.int32))) < 100:
            raise RuntimeError('Invalid narration audio')
        buffer = io.BytesIO()
        with wave.open(buffer, 'wb') as writer:
            writer.setnchannels(1); writer.setsampwidth(2); writer.setframerate(rate); writer.writeframes(audio.tobytes())
        data = buffer.getvalue()
        return Response(data, media_type='audio/wav', headers={'X-Voice-Id': VOICE_ID, 'X-Audio-Sha256': hashlib.sha256(data).hexdigest()})
    except Exception:
        # Provider exceptions can contain absolute paths and request contents; do not return them.
        raise HTTPException(status_code=500, detail='Local public narration failed') from None
    finally:
        lock.release()

if __name__ == '__main__':
    import uvicorn
    uvicorn.run(app, host='127.0.0.1', port=9886, access_log=False)
