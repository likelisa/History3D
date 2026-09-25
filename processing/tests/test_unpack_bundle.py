import os
import pathlib
import stat
import subprocess
import sys
import tempfile
import unittest
import zipfile


ROOT = pathlib.Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "processing" / "tools" / "unpack_bundle.py"
FIXTURE = ROOT / "contracts" / "fixtures" / "handoff" / "collection"


class UnpackBundleTests(unittest.TestCase):
    def test_valid_collection_zip(self):
        with tempfile.TemporaryDirectory() as temp:
            archive = pathlib.Path(temp) / "collection.zip"
            destination = pathlib.Path(temp) / "out"
            with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as zipped:
                for source in FIXTURE.rglob("*"):
                    if source.is_file():
                        zipped.write(source, source.relative_to(FIXTURE))
            result = subprocess.run([sys.executable, str(SCRIPT), str(archive), str(destination)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual((destination / "handoff.json").read_bytes(), (FIXTURE / "handoff.json").read_bytes())

    def test_traversal_and_symlink_are_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            archive = pathlib.Path(temp) / "bad.zip"
            destination = pathlib.Path(temp) / "out"
            with zipfile.ZipFile(archive, "w") as zipped:
                zipped.writestr("../escape.txt", "bad")
            result = subprocess.run([sys.executable, str(SCRIPT), str(archive), str(destination)], capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse((pathlib.Path(temp) / "escape.txt").exists())
            with zipfile.ZipFile(archive, "w") as zipped:
                info = zipfile.ZipInfo("assets/link.glb")
                info.create_system = 3
                info.external_attr = (stat.S_IFLNK | 0o777) << 16
                zipped.writestr(info, "../../escape.txt")
            result = subprocess.run([sys.executable, str(SCRIPT), str(archive), str(destination)], capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)


if __name__ == "__main__":
    unittest.main()
