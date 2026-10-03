"""Publish an independent v12 subtitle candidate only after all frozen-input checks.

No synthesis, ASR, download, training, GUI access or runtime version switch occurs here.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import math
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


REPO = Path(__file__).resolve().parent.parent
SOURCE_DIR = REPO / "viewer/public/mural-assets/narration-v11"
OUTPUT_DIR = REPO / "viewer/public/mural-assets/narration-v12"
SOURCE_MANIFEST_SHA256 = "1b861e03fb33e516bf0765b9872adc30ebeeed8f17eee6642bda1fe3dab65d69"
AUDIT_SHA256 = "80fa1feb193a33c5aa663e847dfeaf6def9813fe61e3f8f3f388631f36c50679"
EXPECTED_IDS = [f"c{chapter}-{cue}" for chapter in range(8) for cue in range(3)]
SUPPORT_FILES = ["reference-uncle-fu.wav", "voice-acceptance.json", "GPT-SoVITS-LICENSE", "SOURCE.md"]


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def finite(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def json_bytes(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode("utf-8")


def load_json(file: Path) -> tuple[bytes, dict[str, Any]]:
    data = file.read_bytes()
    require(not data.startswith(b"\xef\xbb\xbf"), f"UTF-8 BOM is not allowed: {file.name}")
    value = json.loads(data.decode("utf-8"))
    require(isinstance(value, dict), f"Object required: {file.name}")
    return data, value


def index_records(records: Any, label: str) -> dict[str, dict[str, Any]]:
    require(isinstance(records, list) and len(records) == 24, f"{label}: exactly 24 records required")
    require(all(isinstance(record, dict) for record in records), f"{label}: object records required")
    ids = [record.get("id") for record in records]
    require(len(set(ids)) == 24 and set(ids) == set(EXPECTED_IDS), f"{label}: missing, extra or duplicate cue ID")
    return {record["id"]: record for record in records}


def validate_points(text: str, points: Any, audio_seconds: float) -> None:
    require(isinstance(text, str) and bool(text), "Nonempty unchanged display text required")
    require(not any(0xD800 <= ord(character) <= 0xDFFF for character in text), "Unpaired Unicode surrogate rejected")
    require(finite(audio_seconds) and audio_seconds > 0, "Finite positive audio duration required")
    require(isinstance(points, list) and bool(points), "Subtitle points missing")
    previous_time, previous_end = -1.0, 0
    for point in points:
        require(isinstance(point, dict) and set(point) == {"seconds", "textEnd"}, "Point must contain only seconds/textEnd")
        seconds, end = point["seconds"], point["textEnd"]
        require(finite(seconds) and 0 <= seconds <= audio_seconds and seconds >= previous_time, "Point seconds must be finite, monotonic and inside the audio")
        require(isinstance(end, int) and not isinstance(end, bool) and previous_end < end <= len(text), "Point textEnd must increase in Unicode code points")
        previous_time, previous_end = seconds, end
    require(previous_end == len(text), "Subtitle points must cover unchanged Unicode text including punctuation")


def validate_silences(record: dict[str, Any], track: dict[str, Any]) -> list[tuple[float, float, float]]:
    require(record.get("expectedText") == track["text"], f"Audit text differs: {track['id']}")
    duration = record.get("durationSeconds")
    require(finite(duration) and duration > 0 and abs(duration - track["seconds"]) <= 0.2, f"Audit duration differs: {track['id']}")
    spans = record.get("silenceSpans")
    require(isinstance(spans, list), f"Audit silenceSpans missing: {track['id']}")
    result, previous_end = [], -1.0
    for span in spans:
        require(isinstance(span, list) and len(span) == 3 and all(finite(value) for value in span), "Silence span must be [start,end,duration] in seconds")
        start, end, seconds = map(float, span)
        require(0 <= start < end <= track["seconds"] and start >= previous_end and seconds >= 0.5 and abs(end - start - seconds) <= 0.00001, f"Invalid or overlapping long silence: {track['id']}")
        result.append((start, end, seconds)); previous_end = end
    return result


def adjust_points(cue_id: str, text: str, points: list[dict[str, Any]], spans: list[tuple[float, float, float]], audio_seconds: float) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    validate_points(text, points, audio_seconds)
    adjusted, changes = [], []
    previous = -1.0
    for index, point in enumerate(points):
        original = float(point["seconds"])
        seconds, reasons, matched = original, [], None
        for start, end, duration in spans:
            if start < original < end:
                seconds = end
                reasons.append("point_inside_audited_long_silence_moved_to_silence_end")
                matched = {"start": start, "end": end, "duration": duration, "units": "seconds"}
                break
        if seconds < previous:
            seconds = previous
            reasons.append("monotonic_after_prior_silence_adjustment")
        adjusted.append({"seconds": seconds, "textEnd": point["textEnd"]})
        if seconds != original:
            change = {"id": cue_id, "pointIndex": index, "textEnd": point["textEnd"], "originalSeconds": original, "seconds": seconds, "reason": reasons}
            if matched is not None:
                change["silenceSpan"] = matched
            changes.append(change)
        previous = seconds
    validate_points(text, adjusted, audio_seconds)
    return adjusted, changes


def checked_source(name: str) -> bytes:
    file = SOURCE_DIR / name
    require(file.is_file() and not file.is_symlink() and file.resolve().parent == SOURCE_DIR.resolve(), f"Source file not confined: {name}")
    return file.read_bytes()


def prepare(alignment_file: Path, audit_file: Path, aligner_file: Path | None) -> tuple[dict[str, bytes], dict[str, Any]]:
    require(not OUTPUT_DIR.exists() and not OUTPUT_DIR.is_symlink(), "narration-v12 already exists; preserve it and stop")
    manifest_bytes, manifest = load_json(SOURCE_DIR / "manifest.json")
    source_sha = digest(manifest_bytes)
    require(source_sha == SOURCE_MANIFEST_SHA256 and manifest.get("formatVersion") == "11.0.0", "Frozen v11 source manifest changed")
    require(manifest.get("selectedCueIds") == EXPECTED_IDS, "Source selectedCueIds must retain the exact 24-cue order")
    tracks = index_records(manifest.get("tracks"), "Source tracks")
    require(len({track.get("sha256") for track in tracks.values()}) == 24, "Source contains duplicate audio SHA256")
    alignment_bytes, alignment = load_json(alignment_file)
    alignment_sha = digest(alignment_bytes)
    require(alignment.get("sourceManifestSha256") == source_sha and alignment.get("unchangedDisplayText") is True, "Alignment is not bound to frozen unchanged v11 text")
    aligned = index_records(alignment.get("alignments"), "Alignments")
    require(isinstance(alignment.get("scriptSha256"), str) and len(alignment["scriptSha256"]) == 64, "Alignment source script SHA256 missing")
    audit_bytes, audit = load_json(audit_file)
    audit_sha = digest(audit_bytes)
    require(audit_sha == AUDIT_SHA256 and manifest.get("automaticAudioAudit", {}).get("reportSha256") == audit_sha, "Frozen audit report does not match v11 provenance")
    # The audit predates adding automaticAudioAudit to v11. Retain both hashes rather than equating them.
    require(isinstance(audit.get("manifestSha256"), str) and len(audit["manifestSha256"]) == 64, "Audit's pre-annotation manifest SHA256 missing")
    require(audit.get("flaggedIds") == [], "Frozen automatic screening still has flagged tracks")
    audited = index_records(audit.get("records"), "Audit")
    payloads: dict[str, bytes] = {}
    updated = copy.deepcopy(manifest)
    updated_tracks = {track["id"]: track for track in updated["tracks"]}
    changes, published = [], []
    audio_records = []
    for cue_id in EXPECTED_IDS:
        track, entry = tracks[cue_id], aligned[cue_id]
        require(track.get("file") == f"/mural-assets/narration-v11/{cue_id}.mp3", f"Source audio path differs: {cue_id}")
        require(entry.get("text") == track.get("text") and entry.get("audioSha256") == track.get("sha256"), f"Alignment text/audio differs: {cue_id}")
        require(finite(entry.get("textSimilarity")) and 0.82 <= entry["textSimilarity"] <= 1, f"Unreliable ASR coverage: {cue_id}")
        require(finite(track.get("seconds")) and track["seconds"] > 0, f"Invalid audio duration: {cue_id}")
        require(isinstance(track.get("bytes"), int) and not isinstance(track["bytes"], bool) and track["bytes"] > 0, f"Invalid audio byte count: {cue_id}")
        audio = checked_source(cue_id + ".mp3")
        require(len(audio) == track["bytes"] and digest(audio) == track["sha256"], f"Actual frozen audio bytes differ: {cue_id}")
        spans = validate_silences(audited[cue_id], track)
        points, corrections = adjust_points(cue_id, track["text"], entry.get("points"), spans, track["seconds"])
        method = entry.get("method")
        require(isinstance(method, str) and bool(method), f"Alignment method missing: {cue_id}")
        changes.extend(corrections)
        updated_tracks[cue_id]["file"] = f"/mural-assets/narration-v12/{cue_id}.mp3"
        updated_tracks[cue_id]["subtitlePoints"] = points
        updated_tracks[cue_id]["subtitleAudioSha256"] = track["sha256"]
        payloads[cue_id + ".mp3"] = audio
        published.append({"id": cue_id, "text": track["text"], "audioSha256": track["sha256"], "audioSeconds": track["seconds"], "method": method, "points": points, "unicodeCharacters": len(track["text"]), "fullTextCovered": True, "humanWordTimingReviewed": False})
        audio_records.append({"id": cue_id, "sha256": track["sha256"], "bytes": len(audio), "audioUnchanged": True})
    for name in SUPPORT_FILES:
        payloads[name] = checked_source(name)
    payloads["SOURCE.md"] += ("\n## v12 字幕同步\n\n声音和正文沿用 v11，24 条音轨字节不变。字幕以实际播放器位置与本地 Whisper 逐词时间戳出字，并将落在已检测长静音内部的字时点移到静音结束；原始识别、时间戳、校正记录和脚本随本版本保存。时间戳仍是自动估计，完整人耳复核尚未标记通过。\n").encode("utf-8")
    require(digest(payloads["reference-uncle-fu.wav"]) == manifest["reference"]["sha256"], "Frozen public reference SHA256 differs")
    acceptance = json.loads(payloads["voice-acceptance.json"].decode("utf-8"))
    require(acceptance.get("referenceSha256") == manifest["reference"]["sha256"] and acceptance.get("privateReferenceUsed") is False, "Public reference acceptance provenance differs")
    aligner_source = {"file": None, "sha256": alignment["scriptSha256"], "included": False}
    if aligner_file is not None:
        require(aligner_file.is_file(), "Optional aligner source must be a file")
        aligner = aligner_file.read_bytes()
        require(not aligner.startswith(b"\xef\xbb\xbf") and digest(aligner) == alignment["scriptSha256"], "Optional aligner source does not match alignment script SHA256 or contains BOM")
        payloads["subtitle-aligner-source.py"] = aligner
        aligner_source.update({"file": "subtitle-aligner-source.py", "included": True})
    publisher_bytes = Path(__file__).read_bytes()
    publisher_sha = digest(publisher_bytes)
    payloads["subtitle-publisher-source.py"] = publisher_bytes
    payloads["subtitle-alignment.json"] = alignment_bytes
    payloads["subtitle-silence-audit.json"] = audit_bytes
    provenance = {
        "formatVersion": "1.0.0", "status": "candidate-awaiting-gui-and-human-word-timing-review",
        "sourceManifestSha256": source_sha, "alignmentSha256": alignment_sha, "auditSha256": audit_sha,
        "auditSourceManifestSha256": audit["manifestSha256"], "auditBinding": "frozen v11 automaticAudioAudit.reportSha256; audit predates manifest annotation",
        "method": "local CPU Whisper word timestamps with per-word character interpolation; original display text retained; audited long silence adjustment",
        "model": alignment.get("model"), "units": "seconds", "unicodeOffsets": "Unicode code points, including punctuation; matches JavaScript Array.from",
        "coverage": {"expectedTracks": 24, "alignedTracks": 24, "completeTracks": 24}, "coverage24": True,
        "humanWordTimingReviewed": False, "guiSynchronized": False, "audioUnchanged": True,
        "pointAdjustmentsCount": len(changes), "originalAlignmentFile": "subtitle-alignment.json", "publishedAlignmentFile": "subtitle-alignment-adjustments.json", "auditFile": "subtitle-silence-audit.json",
        "alignerSource": aligner_source, "publisherSource": {"file": "subtitle-publisher-source.py", "sha256": publisher_sha},
        "supportFiles": [{"file": name, "sha256": digest(payloads[name]), "bytes": len(payloads[name])} for name in SUPPORT_FILES],
    }
    updated["formatVersion"] = "12.0.0"
    updated["subtitleAlignment"] = provenance
    updated["validationStatus"] = "subtitle-aligned-candidate-awaiting-human-and-gui-review"
    payloads["subtitle-alignment-adjustments.json"] = json_bytes({"formatVersion": "1.0.0", "provenance": provenance, "adjustments": changes, "alignments": published})
    payloads["manifest.json"] = json_bytes(updated)
    receipt = {"formatVersion": "1.0.0", "createdAtUtc": datetime.now(timezone.utc).isoformat(), "targetVersion": "12.0.0", "manifestSha256": digest(payloads["manifest.json"]), "sourceManifestSha256": source_sha, "alignmentSha256": alignment_sha, "auditSha256": audit_sha, "publisherSha256": publisher_sha, "tracks": audio_records, "count": 24, "adjustmentCount": len(changes), "audioUnchanged": True, "runtimeSwitched": False, "guiVerified": False, "humanWordTimingReviewed": False}
    payloads["subtitle-publication-receipt.json"] = json_bytes(receipt)
    # Everything, including JSON serialization and all file reads/hashes, has passed before mkdir.
    require(not OUTPUT_DIR.exists() and not OUTPUT_DIR.is_symlink(), "narration-v12 appeared during validation; stop")
    return payloads, receipt


def main() -> None:
    parser = argparse.ArgumentParser(description="Freeze checked v11 audio and publish an independent v12 subtitle candidate; no synthesis or runtime switch")
    parser.add_argument("--alignment", required=True, type=Path, help="Completed 24-track alignments.json")
    parser.add_argument("--audit", required=True, type=Path, help="Frozen asr-audit-v2/report.json")
    parser.add_argument("--aligner", type=Path, help="Optional exact aligner source matching scriptSha256; copied for handoff")
    args = parser.parse_args()
    payloads, receipt = prepare(args.alignment.resolve(strict=True), args.audit.resolve(strict=True), args.aligner.resolve(strict=True) if args.aligner else None)
    OUTPUT_DIR.mkdir(parents=False, exist_ok=False)
    # Never overwrite/remove a partial version; retain it for audit if any write fails.
    for name, data in payloads.items():
        with (OUTPUT_DIR / name).open("xb") as handle:
            handle.write(data)
    print(json.dumps({"output": str(OUTPUT_DIR), "manifestSha256": receipt["manifestSha256"], "count": receipt["count"], "adjustmentCount": receipt["adjustmentCount"], "audioUnchanged": True, "runtimeSwitched": False, "guiVerified": False}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
