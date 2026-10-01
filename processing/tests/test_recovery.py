import argparse
import io
import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import pipeline


class RecoveryTest(unittest.TestCase):
    def setUp(self):
        env = patch.dict(pipeline.os.environ, {"TRIPO_API_KEY": "test-key"})
        env.start()
        self.addCleanup(env.stop)
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        pipeline.save_json(self.root / 'entities.json', {'entities': [{'id': 'one', 'generation_prompt': 'pot'}, {'id': 'two'}]})
        pipeline.save_json(self.root / 'scene.json', {'placements': [{'entity_id': 'one'}, {'entity_id': 'two'}]})

    def run_command(self, command, **kwargs):
        args = argparse.Namespace(command=command, entity='one', task_id=None, confirm_cost=True)
        for key, value in kwargs.items():
            setattr(args, key, value)
        return pipeline.operate(args, argparse.ArgumentParser(), self.root)

    def row(self, entity='one'):
        return dict(entity_id=entity, task_id='task-' + entity, prompt='pot', status='queued', model_path='', note='')

    def test_missing_credentials_never_creates_intent(self):
        with patch.dict(pipeline.os.environ, {}, clear=True):
            with self.assertRaises(RuntimeError):
                self.run_command('submit')
        self.assertEqual(pipeline.rows_for(self.root), [])

    def test_unknown_submission_is_durable_and_blocks_repeat(self):
        def fail(*args):
            self.assertEqual(pipeline.rows_for(self.root)[0]['status'], 'submitting')
            raise TimeoutError()
        with patch.object(pipeline, 'request_json', side_effect=fail) as api:
            with self.assertRaises(TimeoutError):
                self.run_command('submit')
            self.assertEqual(pipeline.rows_for(self.root)[0]['status'], 'submit_unknown')
            with self.assertRaises(SystemExit):
                self.run_command('submit')
            self.assertEqual(api.call_count, 1)
        with patch.object(pipeline, 'request_json', return_value={'task_id': 'recovered'}):
            self.run_command('recover', task_id='recovered')
        self.assertEqual(pipeline.rows_for(self.root)[0]['task_id'], 'recovered')

    def test_missing_url_requeries_and_other_rows_complete(self):
        pipeline.write_rows(self.root, [self.row(), self.row('two')])
        success = {'status': 'success', 'output': {'model': 'https://example.test/model'}}
        def download(url, path):
            path.write_bytes(struct.pack('<4sII', b'glTF', 2, 12))
        with patch.object(pipeline, 'request_json', side_effect=[{'status': 'success'}, success]), patch.object(pipeline, 'download_model', side_effect=download):
            self.assertEqual(self.run_command('sync'), 1)
        rows = pipeline.rows_for(self.root)
        self.assertEqual([r['status'] for r in rows], ['download_pending', 'success'])
        with patch.object(pipeline, 'request_json', return_value=success) as api, patch.object(pipeline, 'download_model', side_effect=download):
            self.assertEqual(self.run_command('sync'), 0)
            self.assertEqual(api.call_count, 1)

    def test_download_failure_retries_fresh_url(self):
        pipeline.write_rows(self.root, [self.row()])
        success = {'status': 'success', 'output': {'model': 'https://example.test/model'}}
        with patch.object(pipeline, 'request_json', return_value=success), patch.object(pipeline, 'download_model', side_effect=OSError('failure')):
            self.assertEqual(self.run_command('sync'), 1)
        self.assertEqual(pipeline.rows_for(self.root)[0]['status'], 'download_pending')
        with patch.object(pipeline, 'request_json', return_value=success) as api, patch.object(pipeline, 'download_model', side_effect=lambda url, path: path.write_bytes(struct.pack('<4sII', b'glTF', 2, 12))):
            self.assertEqual(self.run_command('sync'), 0)
            self.assertEqual(api.call_count, 1)

    def test_scene_write_failure_does_not_mark_success(self):
        pipeline.write_rows(self.root, [self.row()])
        success = {'status': 'success', 'output': {'model': 'https://example.test/model'}}
        with patch.object(pipeline, 'request_json', return_value=success), patch.object(pipeline, 'download_model', side_effect=lambda url, path: path.write_bytes(struct.pack('<4sII', b'glTF', 2, 12))), patch.object(pipeline, 'save_json', side_effect=OSError()):
            self.assertEqual(self.run_command('sync'), 1)
        self.assertEqual(pipeline.rows_for(self.root)[0]['status'], 'download_pending')
        with patch.object(pipeline, 'request_json', side_effect=AssertionError('must recover offline')) as api, patch.object(pipeline, 'download_model', side_effect=AssertionError('must reuse local model')) as download:
            self.assertEqual(self.run_command('sync'), 0)
            api.assert_not_called()
            download.assert_not_called()
        scene = pipeline.read_json(self.root / 'scene.json')
        self.assertEqual(scene['placements'][0]['candidate_asset'], 'assets/one-task-one.glb')
        self.assertEqual(pipeline.rows_for(self.root)[0]['status'], 'success')

    def test_corrupt_pending_model_downloads_again(self):
        row = self.row()
        row.update(status='download_pending', model_path='assets/one-task-one.glb')
        (self.root / 'assets').mkdir()
        (self.root / row['model_path']).write_bytes(b'corrupt')
        pipeline.write_rows(self.root, [row])
        success = {'status': 'success', 'output': {'model': 'https://example.test/fresh'}}
        with patch.object(pipeline, 'request_json', return_value=success) as api, patch.object(pipeline, 'download_model', side_effect=lambda url, path: path.write_bytes(struct.pack('<4sII', b'glTF', 2, 12))) as download:
            self.assertEqual(self.run_command('sync'), 0)
            api.assert_called_once()
            download.assert_called_once()
        self.assertEqual(pipeline.rows_for(self.root)[0]['status'], 'success')

    def test_atomic_write_and_download_preserve_existing_file(self):
        path = self.root / 'model.glb'
        path.write_bytes(b'previous')
        with self.assertRaises(RuntimeError), patch.object(pipeline, 'urlopen', return_value=io.BytesIO(b'bad')):
            pipeline.download_model('https://example.test/model', path)
        self.assertEqual(path.read_bytes(), b'previous')
        valid = struct.pack('<4sII', b'glTF', 2, 12)
        with patch.object(pipeline, 'urlopen', return_value=io.BytesIO(valid)):
            pipeline.download_model('https://example.test/model', path)
        self.assertEqual(path.read_bytes(), valid)
        with self.assertRaises(OSError), patch.object(pipeline.os, 'replace', side_effect=OSError()):
            pipeline.save_json(path, {})
        self.assertEqual(path.read_bytes(), valid)

    def test_lock_excludes_second_writer(self):
        with pipeline.package_lock(self.root):
            with self.assertRaises(RuntimeError):
                with pipeline.package_lock(self.root):
                    pass


if __name__ == '__main__':
    unittest.main()
