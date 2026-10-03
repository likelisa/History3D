"""Regression tests use synthetic ASR words, never invoke a model or TTS."""
import importlib.util
from pathlib import Path
import unittest

source = Path(__file__).resolve().parent.parent / 'scripts/generate-public-agent-narration.py'
spec = importlib.util.spec_from_file_location('public_narration', source)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class AlignmentBoundaries(unittest.TestCase):
    def test_missing_three_character_clause_is_not_interpolated_into_spoken_text(self):
        prefix = ''.join(chr(0x4e00 + i) for i in range(25))
        suffix = ''.join(chr(0x4e30 + i) for i in range(25))
        text = prefix + '。受扣留。' + suffix + '。'
        words = [{'word': prefix, 'start': .2, 'end': 4}, {'word': suffix, 'start': 4.2, 'end': 8}]
        with self.assertRaisesRegex(RuntimeError, 'entire spoken clause'):
            module.align(text, words, 8.5, [])

    def test_unicode_and_punctuation_are_retained_without_asr_rewriting(self):
        text = '张骞出发。继续西行！'
        words = [{'word': '张谦出发', 'start': .1, 'end': 2}, {'word': '继续西行', 'start': 3, 'end': 5}]
        points, similarity = module.align(text, words, 5.4, [])
        self.assertEqual(points[-1]['textEnd'], len(text))
        self.assertGreater(similarity, .82)
        self.assertEqual(text, '张骞出发。继续西行！')
        self.assertTrue(all(a['seconds'] <= b['seconds'] for a, b in zip(points, points[1:])))

if __name__ == '__main__':
    unittest.main()
