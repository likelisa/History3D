import csv
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import pipeline


class PipelineTest(unittest.TestCase):
    def test_sample_handoff_and_candidate_flow(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "sample"
            shutil.copytree(Path(__file__).resolve().parents[1] / "sample", root)
            (root / "experiments.csv").write_text(",".join(pipeline.FIELDS) + "\n", encoding="utf-8")
            scene = json.loads((root / "scene.json").read_text())
            scene["placements"][0]["candidate_asset"] = None
            (root / "scene.json").write_text(json.dumps(scene), encoding="utf-8")
            self.assertEqual(pipeline.validate(root), [])
            task = {"status": "success", "output": {"pbr_model": "https://example.test/model.glb"}}

            def fake_download(url, path):
                self.assertEqual(url, "https://example.test/model.glb")
                path.write_bytes(b"glTF placeholder")

            with patch.dict(os.environ, {"TRIPO_API_KEY": "test-only"}), patch.object(sys, "argv", ["pipeline.py", "submit", str(root), "--entity", "object_01", "--confirm-cost"]), patch.object(pipeline, "request_json", return_value={"task_id": "test-task"}):
                self.assertEqual(pipeline.main(), 0)
            with patch.object(sys, "argv", ["pipeline.py", "sync", str(root)]), patch.object(pipeline, "request_json", return_value=task), patch.object(pipeline, "download_model", side_effect=fake_download):
                self.assertEqual(pipeline.main(), 0)
            scene = json.loads((root / "scene.json").read_text())
            placement = scene["placements"][0]
            self.assertIsNone(placement["asset"])
            self.assertTrue((root / placement["candidate_asset"]).is_file())
            with (root / "experiments.csv").open(newline="") as f:
                row = next(csv.DictReader(f))
            self.assertEqual(row["status"], "success")
            self.assertEqual(pipeline.validate(root), [])


if __name__ == "__main__":
    unittest.main()
