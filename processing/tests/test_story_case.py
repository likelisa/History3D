from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from contracts import validate_package


class StoryContractTest(unittest.TestCase):
    def test_zhangqian_story_obeys_processing_contract(self):
        root = Path(__file__).resolve().parents[2] / 'public/story/zhangqian-return'
        self.assertEqual(validate_package(root), [])
