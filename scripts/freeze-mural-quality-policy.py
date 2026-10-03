"""Freeze root-reviewed project rules; does not certify any generated run."""
from pathlib import Path
import hashlib
import json
import re

repo = Path(__file__).resolve().parent.parent
source = repo / "docs/agent/mural-case-lessons-r10.md"
raw = source.read_bytes()
rules = []
for line in raw.decode("utf-8").splitlines():
    match = re.match(r"^\| ([ABCD]\d{2}) \| (.+) \| (.+) \|$", line)
    if not match:
        continue
    rule_id, requirement, evidence = match.groups()
    rules.append({"id": rule_id, "stage": rule_id[0], "requirement": requirement,
                  "caseEvidenceRefs": sorted(set(re.findall(r"E\d{2}", evidence))),
                  "releaseBlocking": True,
                  "verificationMode": "mixed" if rule_id in {"A02", "A04", "A05", "B01", "B02", "B04", "B05", "B06", "B07", "B08", "B09", "B11", "C02", "C03", "C04", "D01", "D02", "D03", "D04", "D05"} else "human",
                  "defaultRunState": "pending"})
expected = [f"A{i:02}" for i in range(1, 7)] + [f"B{i:02}" for i in range(1, 12)] + [f"C{i:02}" for i in range(1, 5)] + [f"D{i:02}" for i in range(1, 6)]
if [rule["id"] for rule in rules] != expected:
    raise RuntimeError("Reviewed rule IDs/count do not match the frozen 26-rule set")
policy = {
    "schemaVersion": "1.0.0", "policyId": "mural-story-quality-r10", "status": "fixed-project-standard",
    "authority": "user-requested project quality rules; root-reviewed on 2026-10-03",
    "scope": "project-only; no global skills, memory or safety policy modification",
    "goal": "故事优先：人物目的、事件原因与结果讲清楚；壁画、地图、3D和配音服务故事。",
    "sourceDocument": "../docs/agent/mural-case-lessons-r10.md", "sourceSha256": hashlib.sha256(raw).hexdigest(),
    "desktopOnly": True, "maxConcurrentAgentsIncludingRoot": 3,
    "pipeline": [
        {"stage": "A", "name": "采集与真实初版资产", "requiredOutputs": ["provided-source-excerpts", "causal-story-plan", "reference-provenance", "real-tripo-task-receipts", "raw-pbr-glb"]},
        {"stage": "B", "name": "审核与整合", "requiredOutputs": ["story-review", "asset-calibration", "scene-cue-binding", "complete-narration-manifest", "timeline"]},
        {"stage": "C", "name": "桌面讲解网页", "requiredOutputs": ["source-code", "real-runtime-asset-loading", "caption-below-canvas", "playback-controls", "errors-with-recovery-boundaries"]},
        {"stage": "D", "name": "真实效果与交付验证", "requiredOutputs": ["current-build-and-tests", "visible-natural-playback-evidence", "human-story-and-audio-review", "complete-recording", "full-source-zip-clean-extraction-check"]}
    ],
    "publicVoicePolicy": {"privateVoiceForbiddenWithoutAuthorization": True, "publicSyntheticReferenceCloningAllowedWithUserAuthorization": True, "recordActualCloningMode": True, "noTrainingInNormalBuild": True, "noModelWeightsInDelivery": True},
    "evidencePolicy": {"modelClaimsAreEvidence": False, "providedExcerptMeansIndependentlyVerified": False, "structuralPassMeansVisualPass": False, "previewMeansFinalDelivery": False, "oldRunEvidenceCertifiesNewVersion": False, "defaultState": "pending"},
    "rules": rules
}
destination = repo / "agent/quality-policy.json"
if destination.exists():
    raise RuntimeError("Existing frozen policy must be versioned, not overwritten")
with destination.open("x", encoding="utf-8") as handle:
    handle.write(json.dumps(policy, ensure_ascii=False, indent=2) + "\n")
print(json.dumps({"policy": str(destination), "rules": len(rules), "sourceSha256": policy["sourceSha256"], "certifiesRuns": False}, ensure_ascii=False))
