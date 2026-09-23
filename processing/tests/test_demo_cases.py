from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from contracts import validate_package


class BrowserCaseContractTest(unittest.TestCase):
    root = Path(__file__).resolve().parents[2] / 'public' / 'cases'

    def test_browser_normal_case_passes_processing_contract(self):
        self.assertEqual(validate_package(self.root / 'complete'), [])

    def test_source_fault_is_detected_by_processing_contract(self):
        errors = validate_package(self.root / 'missing-source')
        self.assertTrue(any('source_id' in e for e in errors))

    def test_model_fault_is_detected_by_processing_contract(self):
        errors = validate_package(self.root / 'missing-model')
        self.assertTrue(any('candidate_asset' in e for e in errors))
