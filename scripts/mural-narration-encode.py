#!/usr/bin/env python3
"""Encode 24 already-recorded local WAV clips; no speech/provider/network calls.

The output directory must not exist. Normal npm build does not invoke this script.
Use the exported chapterDefinitions JSON and the Windows SAPI authoring recipe.
"""
from __future__ import annotations

import argparse
from datetime import datetime
import hashlib
import json
import math
from pathlib import Path
import re
import shutil
import subprocess
import sys

EXPECTED_IDS = tuple(f"c{chapter}-{cue}" for chapter in range(8) for cue in range(3))


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def reviewed_cues(source: object) -> list[dict]:
    if not isinstance(source, dict) or not isinstance(source.get("cues"), list):
        raise ValueError("Expected a JSON object containing cues.")
    cues = source["cues"]
    if len(cues) != 24 or [cue.get("id") if isinstance(cue, dict) else None for cue in cues] != list(EXPECTED_IDS):
        raise ValueError("Expected exactly 24 ordered unique cue IDs, c0-0 through c7-2.")
    if any(not isinstance(cue.get("text"), str) or not cue["text"].strip() for cue in cues):
        raise ValueError("Each cue must contain nonempty reviewed text.")
    return cues


def executable(argument: str) -> str:
    resolved = shutil.which(argument)
    if not resolved:
        raise ValueError("Required local executable unavailable: " + argument)
    return resolved


def version(command: str) -> str:
    result = subprocess.run([command, "-version"], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    return result.stdout.decode("utf-8", errors="replace").splitlines()[0]


def run(args: argparse.Namespace) -> dict:
    repo = args.repo.resolve(strict=True)
    cues_path = args.cues.resolve(strict=True)
    wav_dir = args.wav_dir.resolve(strict=True)
    output = args.output_dir.absolute()
    if output.exists():
        raise ValueError("Existing audio directory is preserved; choose a new output directory.")
    if not output.parent.is_dir() or not wav_dir.is_dir():
        raise ValueError("WAV directory and output parent directory must exist.")
    prefix = args.public_prefix.rstrip("/")
    if not prefix.startswith("/") or not re.fullmatch(r"/[A-Za-z0-9_/-]+", prefix) or any(p in {"", ".", ".."} for p in prefix[1:].split("/")):
        raise ValueError("Pass a canonical site-relative public prefix, such as /mural-assets/narration-v2.")
    recorded = datetime.fromisoformat(args.recorded_at.replace("Z", "+00:00"))
    if recorded.tzinfo is None:
        raise ValueError("--recorded-at must include a timezone; it is the source recording time.")
    cues_bytes = cues_path.read_bytes()
    cues = reviewed_cues(json.loads(cues_bytes.decode("utf-8-sig")))
    recording_script = repo / "scripts/mural-narration-windows.ps1"
    if not recording_script.is_file():
        raise ValueError("Repository local SAPI recipe missing.")
    wav_inputs = []
    for cue in cues:
        wav = wav_dir / (cue["id"] + ".wav")
        if not wav.is_file() or wav.is_symlink() or wav.resolve().parent != wav_dir:
            raise ValueError("Missing or linked source WAV: " + cue["id"])
        data = wav.read_bytes()
        if len(data) < 44 or data[:4] != b"RIFF" or data[8:12] != b"WAVE":
            raise ValueError("Invalid RIFF/WAVE input: " + cue["id"])
        wav_inputs.append({"id": cue["id"], "file": wav.name, "bytes": len(data), "sha256": digest(data)})
    encoder, probe = executable(args.ffmpeg), executable(args.ffprobe)
    tools = {"ffmpeg": version(encoder), "ffprobe": version(probe)}
    if args.check_inputs:
        return {"checkedInputs": True, "cues": len(cues), "sourceWavBytes": sum(wav["bytes"] for wav in wav_inputs), "tools": tools, "outputCreated": False}

    # Exclusive creation and FFmpeg -n preserve prior recordings, even on retry.
    output.mkdir()
    tracks = []
    for cue, evidence in zip(cues, wav_inputs):
        wav = wav_dir / evidence["file"]
        if digest(wav.read_bytes()) != evidence["sha256"]:
            raise ValueError("Source WAV changed after validation: " + cue["id"])
        mp3 = output / (cue["id"] + ".mp3")
        subprocess.run([encoder, "-nostdin", "-hide_banner", "-loglevel", "error", "-n", "-i", str(wav), "-ac", "1", "-codec:a", "libmp3lame", "-b:a", "64k", "-map_metadata", "-1", str(mp3)], check=True)
        measured = subprocess.run([probe, "-v", "error", "-show_entries", "format=duration", "-of", "json", str(mp3)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
        seconds = float(json.loads(measured.stdout)["format"]["duration"])
        if not math.isfinite(seconds) or seconds <= 0:
            raise ValueError("Invalid encoded duration: " + cue["id"])
        data = mp3.read_bytes()
        tracks.append({"id": cue["id"], "file": prefix + "/" + mp3.name, "seconds": seconds, "text": cue["text"], "bytes": len(data), "sha256": digest(data)})
    manifest = {
        "formatVersion": "2.0.0", "voice": "Microsoft Huihui Desktop - Chinese (Simplified)",
        "synthesis": "local Windows SAPI", "synthesisRate": -2, "recordedAtUtc": recorded.isoformat(),
        "normalBuildSynthesizes": False, "textSource": "viewer/src/mural/story.ts / chapterDefinitions",
        "sourceScriptSha256": digest(recording_script.read_bytes()),
        "timing": "max(reading floor, measured audio seconds + 1.5 second pause); playback speed affects voice and timeline together",
        "encoding": {"recipe": "mono libmp3lame 64k; metadata stripped; existing output refused", "tools": tools, "encoderScriptSha256": digest(Path(__file__).read_bytes()), "cuesSha256": digest(cues_bytes), "sourceWavs": wav_inputs},
        "tracks": tracks,
    }
    with (output / "manifest.json").open("x", encoding="utf-8", newline="\n") as stream:
        stream.write(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    return {"tracks": len(tracks), "audioSeconds": sum(track["seconds"] for track in tracks), "audioBytes": sum(track["bytes"] for track in tracks), "output": str(output), "source": "already recorded local speech; no provider calls"}


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parent.parent, help="repository containing the source SAPI script (default: this script's repo)")
    parser.add_argument("--cues", type=Path, required=True, help="JSON exported by scripts/mural-narration-data.ts")
    parser.add_argument("--wav-dir", type=Path, required=True, help="directory with 24 matching, already-recorded WAVs")
    parser.add_argument("--output-dir", type=Path, required=True, help="new MP3/manifest directory; existing directories are refused")
    parser.add_argument("--public-prefix", required=True, help="site-relative URL prefix assigned to the newly encoded files")
    parser.add_argument("--recorded-at", required=True, help="source recording timestamp with timezone; no invented recording time")
    parser.add_argument("--ffmpeg", default="ffmpeg", help="local ffmpeg executable or PATH name")
    parser.add_argument("--ffprobe", default="ffprobe", help="local ffprobe executable or PATH name")
    parser.add_argument("--check-inputs", action="store_true", help="validate the recipe and WAVs without encoding or creating output")
    args = parser.parse_args()
    try:
        print(json.dumps(run(args), ensure_ascii=False, indent=2))
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        parser.exit(1, type(error).__name__ + ": " + str(error) + "\n")


if __name__ == "__main__":
    main()
