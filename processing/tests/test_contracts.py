import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from contracts import validate_package


class ContractTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        sample = Path(__file__).resolve().parents[1] / 'sample'
        for path in sample.glob('*.json'):
            shutil.copy(path, self.root / path.name)
        shutil.copy(sample / 'story.md', self.root / 'story.md')
        self.change('scene', lambda d: d['placements'][0].update(candidate_asset=None))

    def change(self, name, fn):
        path = self.root / (name + '.json')
        data = json.loads(path.read_text())
        fn(data)
        path.write_text(json.dumps(data))

    def test_placeholder_is_valid(self):
        self.assertEqual(validate_package(self.root), [])

    def test_recorded_requires_existing_source(self):
        self.change('entities', lambda d: d['entities'][0].update(evidence='recorded', source_ids=['invented']))
        self.assertTrue(any('source_id' in e for e in validate_package(self.root)))

    def test_nonfinite_dimensions_are_rejected(self):
        for bad in (float('nan'), float('inf'), True):
            self.change('entities', lambda d: d['entities'][0].update(dimensions_m=[bad, 2, 2]))
            self.assertTrue(any('dimensions_m' in e for e in validate_package(self.root)))

    def test_candidate_cannot_escape_package(self):
        self.change('scene', lambda d: d['placements'][0].update(candidate_asset='../outside.glb'))
        self.assertTrue(any('candidate_asset' in e for e in validate_package(self.root)))

    def test_wrong_units_rejected(self):
        self.change('scene', lambda d: d.update(units='centimeters'))
        self.assertTrue(any('units' in e for e in validate_package(self.root)))

    def test_malformed_entities_returns_errors(self):
        self.change('entities', lambda d: d.update(entities=[None]))
        self.assertTrue(validate_package(self.root))

    def test_story_mismatch_rejected(self):
        self.change('sources', lambda d: d.update(story_id='other'))
        self.assertTrue(any('story_id' in e for e in validate_package(self.root)))

    def test_sync_allows_missing_candidate_but_not_path_escape(self):
        self.change('scene', lambda d: d['placements'][0].update(candidate_asset='assets/missing.glb'))
        self.assertTrue(validate_package(self.root))
        self.assertEqual(validate_package(self.root, allow_missing_candidate=True), [])
        self.change('scene', lambda d: d['placements'][0].update(candidate_asset='../missing.glb'))
        self.assertTrue(validate_package(self.root, allow_missing_candidate=True))
