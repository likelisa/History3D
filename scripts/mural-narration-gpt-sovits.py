"""Explicit local synthesis using an authorized public synthetic reference.

Never installs, trains, launches a server or calls a hosted generation API.
Existing completed clips may be reused only after SHA and request verification.
An intent without a completed receipt is unknown and must be inspected manually.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import re
import shutil
import struct
import subprocess
import time
import urllib.error
import urllib.request
import wave

REFERENCE_SHA = "f47d4c2e50cdbc2dee165d7cd2415c5e667c9af68863127701344c20b6f73e37"
REFERENCE_TEXT = "西汉时，汉武帝想找到一个盟友，共同对抗匈奴。张骞的故事，就从这项任务开始。"
HINTS = {"月氏": "月支", "大宛": "大渊", "身毒": "捐读", "单于": "蝉于"}
READINGS = {"月氏": "yue4 zhi1", "大宛": "da4 yuan1", "身毒": "juan1 du2", "单于": "chan2 yu2"}
PARAMETERS = {
    "text_lang": "zh", "prompt_lang": "zh", "text_split_method": "cut0",
    "batch_size": 1, "media_type": "wav", "streaming_mode": False,
    "parallel_infer": True, "speed_factor": 1.0, "seed": 12345,
    "top_k": 15, "top_p": 0.6, "temperature": 0.6,
    "repetition_penalty": 1.35, "super_sampling": False,
}

def digest(data):
    return hashlib.sha256(data).hexdigest()

def write_new(path, value):
    with path.open("x", encoding="utf-8") as handle:
        handle.write(json.dumps(value, ensure_ascii=False, indent=2) + "\n")

def command(arguments):
    result = subprocess.run(arguments, capture_output=True, check=False)
    if result.returncode:
        raise RuntimeError(result.stderr.decode("utf-8", errors="replace")[-3000:])
    return result.stdout

def wav_details(path):
    with wave.open(str(path), "rb") as audio:
        frames, rate, channels, width = audio.getnframes(), audio.getframerate(), audio.getnchannels(), audio.getsampwidth()
        raw = audio.readframes(frames)
    if width != 2 or channels != 1 or len(raw) != frames * width or frames <= 0:
        raise RuntimeError("Incomplete or unexpected PCM WAV")
    samples = struct.unpack("<" + "h" * frames, raw)
    peak = max(abs(sample) for sample in samples) / 32768
    rms = math.sqrt(sum(sample * sample for sample in samples) / frames) / 32768
    if not 3 <= frames / rate <= 60 or not .005 < peak < .999 or rms <= .0005:
        raise RuntimeError("Silent, clipped or unreasonable WAV duration")
    return {"rate": rate, "seconds": frames / rate, "samples": frames, "peak": peak, "rms": rms}

def main(args):
    repo = Path(__file__).resolve().parent.parent
    cues_path = args.cues.resolve(strict=True)
    source = cues_path.read_bytes()
    cues = json.loads(source.decode("utf-8"))["cues"]
    if len(cues) != 24 or len({cue["id"] for cue in cues}) != 24:
        raise RuntimeError("Expected all 24 current story cues")
    for cue in cues:
        if not re.fullmatch(r"c[0-7]-[0-2]", cue["id"]) or not cue["text"].strip():
            raise RuntimeError("Invalid story cue")
    reference = args.reference.resolve(strict=True)
    if digest(reference.read_bytes()) != REFERENCE_SHA:
        raise RuntimeError("Public reference changed")
    authorization = json.loads(args.acceptance.resolve(strict=True).read_text(encoding="utf-8"))
    if authorization.get("acceptedScope") != "preview-timbre-and-full-narration-production" or authorization.get("referenceSha256") != REFERENCE_SHA:
        raise RuntimeError("Full production requires the confirmed public reference acceptance")
    if not args.run:
        print(json.dumps({"dryRun": True, "cueCount": len(cues), "paidCalls": 0, "training": False}, ensure_ascii=False))
        return
    output, evidence = args.output.resolve(), args.evidence.resolve()
    output.mkdir(parents=True, exist_ok=True)
    evidence.mkdir(parents=True, exist_ok=True)
    if (output / "manifest.json").exists():
        raise RuntimeError("Complete output already exists; refusing a new production run")
    ffmpeg, ffprobe = shutil.which("ffmpeg"), shutil.which("ffprobe")
    if not ffmpeg or not ffprobe:
        raise RuntimeError("Existing ffmpeg and ffprobe are required; nothing is installed automatically")
    story_sha = digest((repo / "viewer/src/mural/story.ts").read_bytes())
    model_root = args.model_root.resolve(strict=True)
    model_files = [model_root / "GPT_SoVITS/pretrained_models/s1v3.ckpt", model_root / "GPT_SoVITS/pretrained_models/v2Pro/s2Gv2ProPlus.pth"]
    model_hashes = {path.name: digest(path.read_bytes()) for path in model_files}
    session = {"cueSha256": digest(source), "storySha256": story_sha, "referenceSha256": REFERENCE_SHA,
               "modelHashes": model_hashes, "scriptSha256": digest(Path(__file__).read_bytes()), "parameters": PARAMETERS,
               "phoneticHints": HINTS, "voiceCloningUsed": True, "privateReferenceUsed": False, "training": False}
    session_path = evidence / "session.json"
    if session_path.exists():
        if json.loads(session_path.read_text(encoding="utf-8")) != session:
            raise RuntimeError("Frozen production session does not match")
    else:
        write_new(session_path, session)
    tracks, source_wavs = [], []
    for cue in cues:
        cue_id, display_text = cue["id"], cue["text"]
        spoken_text = display_text
        for original, phonetic in HINTS.items():
            spoken_text = spoken_text.replace(original, phonetic)
        payload = {**PARAMETERS, "text": spoken_text, "prompt_text": REFERENCE_TEXT, "ref_audio_path": reference.as_posix()}
        intent = evidence / (cue_id + "-request.json")
        completed = evidence / (cue_id + "-complete.json")
        wav_path, mp3_path = evidence / (cue_id + ".wav"), output / (cue_id + ".mp3")
        if completed.exists():
            previous = json.loads(completed.read_text(encoding="utf-8"))
            if json.loads(intent.read_text(encoding="utf-8")) != payload or previous["track"]["text"] != display_text or digest(wav_path.read_bytes()) != previous["wavSha256"] or digest(mp3_path.read_bytes()) != previous["track"]["sha256"]:
                raise RuntimeError("Completed clip/request mismatch: " + cue_id)
            tracks.append(previous["track"])
            source_wavs.append(previous["sourceWav"])
            print(json.dumps({"id": cue_id, "status": "verified-reuse"}), flush=True)
            continue
        if intent.exists() or wav_path.exists() or mp3_path.exists():
            raise RuntimeError("Unknown/incomplete prior request requires manual inspection: " + cue_id)
        write_new(intent, payload)
        started = time.monotonic()
        try:
            request = urllib.request.Request("http://127.0.0.1:9885/tts", data=json.dumps(payload, ensure_ascii=False).encode("utf-8"), headers={"Content-Type": "application/json"}, method="POST")
            with urllib.request.urlopen(request, timeout=300) as response:
                body = response.read()
                status = response.status
            if status != 200 or body[:4] != b"RIFF" or body[8:12] != b"WAVE":
                raise RuntimeError("Local TTS did not return WAV")
            with wav_path.open("xb") as handle:
                handle.write(body)
            details = wav_details(wav_path)
            command([ffmpeg, "-nostdin", "-hide_banner", "-loglevel", "error", "-n", "-i", str(wav_path), "-ar", "32000", "-ac", "1", "-codec:a", "libmp3lame", "-b:a", "128k", str(mp3_path)])
            measured = json.loads(command([ffprobe, "-v", "error", "-show_entries", "format=duration,size", "-of", "json", str(mp3_path)]))
            seconds = float(measured["format"]["duration"])
            decoded = command([ffmpeg, "-nostdin", "-hide_banner", "-loglevel", "error", "-i", str(mp3_path), "-f", "s16le", "-ac", "1", "-ar", "32000", "-"])
            if abs(len(decoded) / 64000 - details["seconds"]) > .15 or abs(seconds - details["seconds"]) > .15:
                raise RuntimeError("MP3 decoded duration differs from WAV")
            mp3 = mp3_path.read_bytes()
            track = {"id": cue_id, "file": "/mural-assets/narration-v10/" + mp3_path.name, "seconds": seconds, "text": display_text, "bytes": len(mp3), "sha256": digest(mp3)}
            wav_record = {"id": cue_id, "file": wav_path.name, "sha256": digest(body), "bytes": len(body), **details, "synthesisText": spoken_text}
            result = {"status": "complete-decode-checked", "httpStatus": status, "elapsedSeconds": round(time.monotonic() - started, 3), "wavSha256": digest(body), "sourceWav": wav_record, "track": track, "humanPronunciationReviewed": False}
            write_new(completed, result)
            tracks.append(track)
            source_wavs.append(wav_record)
            print(json.dumps({"id": cue_id, "status": "complete", "seconds": seconds, "elapsedSeconds": result["elapsedSeconds"]}), flush=True)
        except Exception as exc:
            write_new(evidence / (cue_id + "-failure.json"), {"error": str(exc), "retryAttempted": False, "status": "requires-inspection"})
            raise
    if source != cues_path.read_bytes() or story_sha != digest((repo / "viewer/src/mural/story.ts").read_bytes()):
        raise RuntimeError("Story or cue export changed during synthesis")
    if len({track["sha256"] for track in tracks}) != len(tracks):
        raise RuntimeError("Duplicate audio bytes across different cues")
    manifest = {
        "formatVersion": "10.0.0", "voice": "GPT-SoVITS v2ProPlus / public Qwen Uncle_fu reference",
        "synthesis": "local pretrained reference inference with authorized public synthetic reference; no training",
        "sampleRate": 32000, "recordedAtUtc": datetime.now(timezone.utc).isoformat(), "normalBuildSynthesizes": False,
        "privateReferenceUsed": False, "voiceCloningUsed": True, "textSource": "viewer/src/mural/story.ts / chapterDefinitions",
        "textUnchanged": True, "textSourceSha256": story_sha, "cuesSha256": digest(source),
        "sourceScriptSha256": digest(Path(__file__).read_bytes()),
        "model": {"name": "GPT-SoVITS v2ProPlus official pretrained", "source": "https://github.com/RVC-Boss/GPT-SoVITS", "license": "MIT", "weightSha256": model_hashes, "weightsIncludedInDelivery": False},
        "reference": {"type": "publicSyntheticReference", "preset": "Qwen3-TTS CustomVoice / Uncle_fu / Chinese / 1.7B", "sha256": REFERENCE_SHA, "seconds": 8.616875, "text": REFERENCE_TEXT, "source": "https://huggingface.co/spaces/Qwen/Qwen3-TTS", "modelLicense": "Apache-2.0"},
        "parameters": PARAMETERS, "pronunciationHints": READINGS, "synthesisTextReplacements": HINTS,
        "humanListening": {"previewAccepted": True, "fullNarrationReviewed": False, "properNamesReviewed": False},
        "selectedCueIds": [cue["id"] for cue in cues], "sourceWavs": source_wavs, "tracks": tracks,
    }
    write_new(output / "manifest.json", manifest)
    write_new(evidence / "production-complete.json", {"tracks": len(tracks), "audioSeconds": sum(track["seconds"] for track in tracks), "manifestSha256": digest((output / "manifest.json").read_bytes()), "storyUnchanged": True, "humanFullListeningPending": True})
    print(json.dumps({"status": "all-clips-generated-decode-checked", "tracks": len(tracks), "audioSeconds": sum(track["seconds"] for track in tracks)}, ensure_ascii=False), flush=True)

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--cues", required=True, type=Path)
    parser.add_argument("--reference", required=True, type=Path)
    parser.add_argument("--acceptance", required=True, type=Path)
    parser.add_argument("--model-root", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--evidence", required=True, type=Path)
    parser.add_argument("--run", action="store_true")
    main(parser.parse_args())
