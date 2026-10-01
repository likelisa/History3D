import hashlib
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from contracts import validate_package
from pipeline import validate_glb


class SouthDetourPackageTest(unittest.TestCase):
    root = Path(__file__).resolve().parents[2] / 'processing/demo/public/story/south-detour'

    def test_story_package_and_candidate_asset(self):
        self.assertEqual(validate_package(self.root), [])
        scene = json.loads((self.root / 'scene.json').read_text())
        self.assertEqual(len(scene['story_points']), 3)
        candidate = self.root / 'assets/foothill-boulder-demo.glb'
        validate_glb(candidate)
        manifest = json.loads((self.root / 'assets/manifest.json').read_text())
        self.assertEqual(candidate.stat().st_size, manifest['delivered_bytes'])
        self.assertEqual(hashlib.sha256(candidate.read_bytes()).hexdigest(), manifest['delivered_sha256'])
        self.assertEqual(manifest['status'], 'candidate')
        self.assertFalse(any(p['asset'] for p in scene['placements']))
