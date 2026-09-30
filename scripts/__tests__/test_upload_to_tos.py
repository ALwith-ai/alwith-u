import importlib.util
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("upload_to_tos", Path(__file__).parents[1] / "upload-to-tos.py")
assert spec is not None and spec.loader is not None
uploader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(uploader)


class UploadToTosTests(unittest.TestCase):
    def test_mirrors_binaries_and_signatures_but_not_update_metadata(self) -> None:
        names = [
            "alwith-u_0.1.0_macos_aarch64.dmg",
            "alwith-u_0.1.0_macos_aarch64.app.tar.gz",
            "alwith-u_0.1.0_macos_aarch64.app.tar.gz.sig",
            "alwith-u_0.1.0_windows_x64-setup.exe",
            "alwith-u_0.1.0_windows_x64-setup.exe.sig",
            "alwith-u_0.1.0_windows_arm64.msi",
        ]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in names + ["latest.json", "notes.txt"]:
                (root / name).write_bytes(b"fixture")
            uploaded: dict[str, bytes] = {}

            def upload(file: Path, key: str) -> None:
                uploaded[key] = file.read_bytes()

            count = uploader.mirror_release(root, "v0.1.0", upload)
            self.assertEqual(count, len(names))
            self.assertEqual(uploaded, {f"alwith-u/release/v0.1.0/{name}": b"fixture" for name in names})

    def test_rejects_invalid_inputs_before_upload(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)

            def upload(file: Path, key: str) -> None:
                self.fail("Invalid input must not reach TOS")

            for tag in ["v0.1.0/../other", "0.1.0", "v01.1.0"]:
                with self.subTest(tag=tag), self.assertRaises(ValueError):
                    uploader.mirror_release(root, tag, upload)
            with self.assertRaisesRegex(ValueError, "No release assets"):
                uploader.mirror_release(root, "v0.1.0", upload)
            file = root / "alwith-u_0.1.0_macos_aarch64.dmg"
            file.write_bytes(b"")
            with self.assertRaisesRegex(ValueError, "empty"):
                uploader.mirror_release(root, "v0.1.0", upload)
            file.write_bytes(b"fixture")
            with self.assertRaisesRegex(ValueError, "version"):
                uploader.mirror_release(root, "v0.2.0", upload)

    def test_upload_failure_propagates(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "alwith-u_0.1.0_macos_aarch64.dmg").write_bytes(b"fixture")

            def upload(file: Path, key: str) -> None:
                raise RuntimeError("TOS unavailable")

            with self.assertRaisesRegex(RuntimeError, "TOS unavailable"):
                uploader.mirror_release(root, "v0.1.0", upload)


if __name__ == "__main__":
    unittest.main()
