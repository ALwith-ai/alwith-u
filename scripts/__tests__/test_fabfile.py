import tempfile
import unittest
from pathlib import Path

from fabfile import update_version


class VersionTaskTests(unittest.TestCase):
    def test_updates_only_app_version_across_manifests(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "src-tauri").mkdir()
            (root / "package.json").write_text('{"version": "0.1.1", "other": "keep"}\n')
            (root / "src-tauri/Cargo.toml").write_text(
                '[package]\nname = "alwith-u"\nversion = "0.1.1"\n\n[dependencies]\nother = "1"\n'
            )
            (root / "src-tauri/Cargo.lock").write_text(
                '[[package]]\nname = "alwith-u"\nversion = "0.1.1"\n\n'
                '[[package]]\nname = "other"\nversion = "1.0.0"\n'
            )

            update_version(root, "0.2.0")

            self.assertIn('"version": "0.2.0"', (root / "package.json").read_text())
            self.assertIn('version = "0.2.0"', (root / "src-tauri/Cargo.toml").read_text())
            lock = (root / "src-tauri/Cargo.lock").read_text()
            self.assertIn('name = "alwith-u"\nversion = "0.2.0"', lock)
            self.assertIn('name = "other"\nversion = "1.0.0"', lock)

    def test_rejects_invalid_version_without_writing(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "src-tauri").mkdir()
            package = root / "package.json"
            package.write_text('{"version": "0.1.1"}\n')
            with self.assertRaisesRegex(ValueError, "SemVer"):
                update_version(root, "v0.2")
            self.assertEqual(package.read_text(), '{"version": "0.1.1"}\n')

    def test_rejects_manifest_mismatch_before_writing(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "src-tauri").mkdir()
            package = root / "package.json"
            package.write_text('{"version": "0.1.1"}\n')
            (root / "src-tauri/Cargo.toml").write_text('[package]\nname = "alwith-u"\nversion = "0.1.0"\n')
            (root / "src-tauri/Cargo.lock").write_text('[[package]]\nname = "alwith-u"\nversion = "0.1.1"\n')

            with self.assertRaisesRegex(ValueError, "versions differ"):
                update_version(root, "0.2.0")
            self.assertEqual(package.read_text(), '{"version": "0.1.1"}\n')


if __name__ == "__main__":
    unittest.main()
