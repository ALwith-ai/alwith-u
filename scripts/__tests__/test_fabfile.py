import io
import json
import subprocess
import tempfile
import unittest
from contextlib import redirect_stderr
from urllib.error import URLError
from pathlib import Path
from typing import IO
from unittest.mock import call, patch

from invoke import Collection, Context, Program
from invoke.exceptions import Exit, UnexpectedExit
from invoke.runners import Result

from fabfile import ROOT, toolchain, update_toolchain_pins, update_version
import fabfile


class UpgradeTaskTests(unittest.TestCase):
    def test_upgrade_rejects_mismatched_tauri_package_minors(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "src-tauri").mkdir()
            (root / "src-tauri/Cargo.lock").write_text(
                '[[package]]\nname = "tauri-plugin-http"\nversion = "2.7.0"\n'
            )
            (root / "package.json").write_text(json.dumps({
                "dependencies": {"@tauri-apps/plugin-http": "^2.6.1"},
            }))
            npm_manifest = root / "node_modules/@tauri-apps/plugin-http/package.json"
            npm_manifest.parent.mkdir(parents=True)
            npm_manifest.write_text('{"version": "2.6.1"}\n')

            commands = []

            def record(context: Context, command: str, **options: object) -> Result:
                commands.append(command)
                return Result(exited=0)

            with patch("fabfile.ROOT", root), patch.object(Context, "run", record):
                with self.assertRaisesRegex(
                    Exit,
                    r"tauri-plugin-http \(v2\.7\.0\) : @tauri-apps/plugin-http \(v2\.6\.1\)",
                ):
                    fabfile.upgrade(Context())
                self.assertEqual(commands[-1], "bun update")

                npm_manifest.write_text('{"version": "2.7.3"}\n')
                commands.clear()
                fabfile.upgrade(Context())
                self.assertEqual(commands[-1], "bun update")

    def test_upgrade_and_alias_run_in_project_directories(self) -> None:
        for name in ("upgrade", "u"):
            with self.subTest(name=name):
                commands = []

                def record(context: Context, command: str, **options: object) -> Result:
                    commands.append((context.cwd, command, options))
                    return Result(exited=0)

                with patch.object(Context, "run", record):
                    Program(namespace=Collection.from_module(fabfile)).run(["fab", name], exit=False)
                self.assertEqual(commands, [
                    (str(ROOT / "src-tauri"), "cargo update", {}),
                    (str(ROOT / "src-tauri"), "command -v cargo-outdated", {"warn": True, "hide": True}),
                    (str(ROOT / "src-tauri"), "cargo outdated --root-deps-only --workspace --ignore-external-rel", {"warn": True}),
                    (str(ROOT), "bun outdated", {}),
                    (str(ROOT), "bun update", {}),
                ])

    def test_installs_missing_cargo_outdated(self) -> None:
        commands = []

        def record(context: Context, command: str, **options: object) -> Result:
            commands.append(command)
            return Result(exited=1 if command == "command -v cargo-outdated" else 0)

        with patch.object(Context, "run", record):
            Program(namespace=Collection.from_module(fabfile)).run(["fab", "upgrade"], exit=False)
        self.assertIn("cargo install cargo-outdated", commands)
        self.assertLess(commands.index("cargo install cargo-outdated"), commands.index(
            "cargo outdated --root-deps-only --workspace --ignore-external-rel"
        ))

    def test_upgrade_stops_when_dependency_update_fails(self) -> None:
        commands = []

        def fail(context: Context, command: str, **options: object) -> Result:
            commands.append(command)
            raise UnexpectedExit(Result(command=command, exited=1))

        with patch.object(Context, "run", fail):
            with self.assertRaises(UnexpectedExit):
                fabfile.upgrade(Context())
        self.assertEqual(commands, ["cargo update"])


class VersionTaskTests(unittest.TestCase):
    def test_cli_reports_invalid_input_without_traceback_or_file_changes(self) -> None:
        for task_name in ["v", "version"]:
            for answer in ["invalid", "v0.1.2", "0.1.2-01"]:
                with self.subTest(task=task_name, answer=answer), tempfile.TemporaryDirectory() as directory:
                    root = Path(directory)
                    contents = self.fixture(root)
                    stderr = io.StringIO()
                    with patch("fabfile.ROOT", root), patch("builtins.input", return_value=answer), redirect_stderr(stderr):
                        with self.assertRaises(SystemExit) as failure:
                            Program(namespace=Collection.from_module(fabfile)).run(["fab", task_name])
                    self.assertEqual(failure.exception.code, 1)
                    self.assertEqual(stderr.getvalue().strip(), f"Version update failed: Expected a SemVer version, got {answer!r}")
                    self.assertEqual({path: path.read_bytes() for path in contents}, contents)

    def fixture(self, root: Path) -> dict[Path, bytes]:
        (root / "src-tauri").mkdir()
        contents = {
            root / "package.json": b'{"version": "0.1.1", "other": "keep"}\n',
            root / "src-tauri/Cargo.toml": b'[package]\nname = "alwith-u"\nversion = "0.1.1"\n',
            root / "src-tauri/Cargo.lock": (
                b'[[package]]\nname = "alwith-u"\nversion = "0.1.1"\n\n'
                b'[[package]]\nname = "other"\nversion = "1.0.0"\n'
            ),
        }
        for path, content in contents.items():
            path.write_bytes(content)
        return contents

    def test_rejects_invalid_semver_identifiers_without_changing_any_file(self) -> None:
        for version in [
            "0.1.2-01", "0.1.2-alpha..1", "0.1.2+build..1", "0.1.2-", "0.1.2+",
            "0.1.2-.alpha", "0.1.2+build.", "01.1.2", "0.1.2\n", "0.1.2٣", "v0.1.2",
        ]:
            with self.subTest(version=version), tempfile.TemporaryDirectory() as directory:
                contents = self.fixture(Path(directory))
                with self.assertRaisesRegex(ValueError, "SemVer"):
                    update_version(Path(directory), version)
                self.assertEqual({path: path.read_bytes() for path in contents}, contents)

    def test_accepts_valid_semver_including_prerelease_and_build_metadata(self) -> None:
        for version in ["0.1.2", "1.0.0-0", "1.0.0-alpha.1", "1.0.0-01a", "1.0.0+001", "1.0.0-rc.1+build.42"]:
            with self.subTest(version=version), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                self.fixture(root)
                update_version(root, version)
                self.assertEqual(json.loads((root / "package.json").read_text())["version"], version)
                self.assertIn(f'version = "{version}"', (root / "src-tauri/Cargo.toml").read_text())
                self.assertIn(f'name = "alwith-u"\nversion = "{version}"', (root / "src-tauri/Cargo.lock").read_text())

    def test_restores_every_attempted_file_after_partial_write_and_allows_retry(self) -> None:
        for failed_name in ["package.json", "src-tauri/Cargo.toml", "src-tauri/Cargo.lock"]:
            with self.subTest(file=failed_name), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                contents = self.fixture(root)
                original_open = Path.open
                failed = False

                def fail_open(path: Path, mode: str = "r", *args: object, **kwargs: object) -> IO[str] | IO[bytes]:
                    nonlocal failed
                    if path == root / failed_name and "w" in mode and not failed:
                        failed = True
                        with original_open(path, "wb") as stream:
                            stream.write(b"partial")
                        raise OSError("simulated partial write")
                    return original_open(path, mode, *args, **kwargs)

                with patch.object(Path, "open", fail_open):
                    with self.assertRaisesRegex(OSError, "simulated partial write"):
                        update_version(root, "0.1.2")
                self.assertEqual({path: path.read_bytes() for path in contents}, contents)
                update_version(root, "0.1.2")
                self.assertEqual(json.loads((root / "package.json").read_text())["version"], "0.1.2")

    def test_reports_rollback_failure_and_still_restores_other_files(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            contents = self.fixture(root)
            original_open = Path.open
            failed = False

            def fail_open(path: Path, mode: str = "r", *args: object, **kwargs: object) -> IO[str] | IO[bytes]:
                nonlocal failed
                if "w" in mode:
                    if path == root / "src-tauri/Cargo.lock" and not failed:
                        failed = True
                        raise OSError("initial write failure")
                    if failed and path == root / "src-tauri/Cargo.toml":
                        raise OSError("rollback write failure")
                return original_open(path, mode, *args, **kwargs)

            with patch.object(Path, "open", fail_open):
                with self.assertRaisesRegex(RuntimeError, "Cargo.toml") as failure:
                    update_version(root, "0.1.2")
            self.assertIn("rollback write failure", str(failure.exception))
            self.assertEqual(str(failure.exception.__cause__), "initial write failure")
            for filename in ["package.json", "src-tauri/Cargo.lock"]:
                self.assertEqual((root / filename).read_bytes(), contents[root / filename])
            self.assertIn('version = "0.1.2"', (root / "src-tauri/Cargo.toml").read_text())

    def test_unchanged_cli_input_still_checks_all_manifest_versions(self) -> None:
        for answer in ["", "0.1.1"]:
            for filename in ["src-tauri/Cargo.toml", "src-tauri/Cargo.lock"]:
                with self.subTest(answer=answer, file=filename), tempfile.TemporaryDirectory() as directory:
                    root = Path(directory)
                    contents = self.fixture(root)
                    path = root / filename
                    path.write_bytes(contents[path].replace(b"0.1.1", b"0.1.0"))
                    contents[path] = path.read_bytes()
                    with patch("fabfile.ROOT", root), patch("builtins.input", return_value=answer):
                        with self.assertRaisesRegex(Exit, "versions differ"):
                            fabfile.version(Context())
                    self.assertEqual({path: path.read_bytes() for path in contents}, contents)

    def test_unchanged_version_does_not_rewrite_manifests(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            contents = self.fixture(root)
            before = {path: path.stat().st_mtime_ns for path in contents}
            update_version(root, "0.1.1")
            self.assertEqual({path: path.read_bytes() for path in contents}, contents)
            self.assertEqual({path: path.stat().st_mtime_ns for path in contents}, before)

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


class ToolchainTaskTests(unittest.TestCase):
    def test_cli_reports_invalid_version_without_traceback(self) -> None:
        stderr = io.StringIO()
        with patch("builtins.input", side_effect=["invalid", ""]), redirect_stderr(stderr):
            with self.assertRaises(SystemExit) as failure:
                Program(namespace=Collection(toolchain)).run(["fab", "toolchain"])
        self.assertEqual(failure.exception.code, 1)
        self.assertIn("Bun version must be an exact X.Y.Z version", stderr.getvalue())
        self.assertNotIn("Traceback", stderr.getvalue())

    def test_rejects_wrong_local_bun_before_changing_manifest(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            package = root / "package.json"
            original = (ROOT / "package.json").read_text()
            package.write_text(original)
            (root / "src-tauri/resources/licenses").mkdir(parents=True)
            (root / "src-tauri/resources/licenses/bun-9.8.7.md").write_text("license")

            with patch("fabfile.ROOT", root), patch("builtins.input", side_effect=["9.8.7", ""]), \
                    patch("fabfile.subprocess.run") as process, patch("fabfile.run") as commands:
                process.return_value.stdout = "1.4.0\n"
                with self.assertRaisesRegex(Exit, "Bun 9.8.7"):
                    toolchain(Context())
                commands.assert_not_called()
            self.assertEqual(package.read_text(), original)

    def test_downloads_missing_versioned_bun_license_before_updating_manifest(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            package = root / "package.json"
            original = (ROOT / "package.json").read_text()
            package.write_text(original)

            with patch("fabfile.ROOT", root), patch("builtins.input", side_effect=["9.8.7", ""]), \
                    patch("fabfile.subprocess.run") as process, patch("fabfile.run") as commands, \
                    patch("urllib.request.urlopen") as fetch:
                process.return_value.stdout = "9.8.7\n"
                fetch.return_value.__enter__.return_value.read.return_value = b"Bun 9.8.7 license\n"
                toolchain(Context())
                fetch.assert_called_once_with(
                    "https://raw.githubusercontent.com/oven-sh/bun/bun-v9.8.7/LICENSE.md", timeout=15
                )
                self.assertEqual(commands.call_count, 3)
            self.assertEqual(json.loads(package.read_text())["packageManager"], "bun@9.8.7")
            self.assertEqual(
                (root / "src-tauri/resources/licenses/bun-9.8.7.md").read_text(),
                "Source: https://github.com/oven-sh/bun/blob/bun-v9.8.7/LICENSE.md\n\nBun 9.8.7 license\n",
            )

    def test_download_failure_keeps_manifest_unchanged(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            package = root / "package.json"
            original = (ROOT / "package.json").read_text()
            package.write_text(original)

            with patch("fabfile.ROOT", root), patch("builtins.input", side_effect=["9.8.7", ""]), \
                    patch("fabfile.subprocess.run") as process, patch("fabfile.run") as commands, \
                    patch("urllib.request.urlopen", side_effect=URLError("offline")):
                process.return_value.stdout = "9.8.7\n"
                with self.assertRaisesRegex(Exit, "Bun 9.8.7 licence"):
                    toolchain(Context())
                commands.assert_not_called()
            self.assertEqual(package.read_text(), original)
            self.assertFalse((root / "src-tauri/resources/licenses/bun-9.8.7.md").exists())

    def test_empty_download_keeps_manifest_unchanged(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            package = root / "package.json"
            original = (ROOT / "package.json").read_text()
            package.write_text(original)

            with patch("fabfile.ROOT", root), patch("builtins.input", side_effect=["9.8.7", ""]), \
                    patch("fabfile.subprocess.run") as process, patch("fabfile.run") as commands, \
                    patch("urllib.request.urlopen", return_value=io.BytesIO(b"")):
                process.return_value.stdout = "9.8.7\n"
                with self.assertRaisesRegex(Exit, "Empty Bun 9.8.7 licence"):
                    toolchain(Context())
                commands.assert_not_called()
            self.assertEqual(package.read_text(), original)

    def test_same_versions_retry_install_check_and_stage(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            package = root / "package.json"
            original = (ROOT / "package.json").read_text()
            package.write_text(original)
            bun_version = json.loads(original)["packageManager"].removeprefix("bun@")
            licenses = root / "src-tauri/resources/licenses"
            licenses.mkdir(parents=True)
            (licenses / f"bun-{bun_version}.md").write_text("license")

            with patch("fabfile.ROOT", root), patch("builtins.input", side_effect=["", ""]), \
                    patch("fabfile.subprocess.run") as process, patch("fabfile.run") as commands, \
                    patch("urllib.request.urlopen") as fetch:
                process.return_value.stdout = f"{bun_version}\n"
                toolchain(Context())
                fetch.assert_not_called()
                commands.assert_has_calls([
                    call("bun", "install"),
                    call("bun", "scripts/check-toolchain.ts"),
                    call("bun", "run", "stage"),
                ])
                self.assertEqual(commands.call_count, 3)
            self.assertEqual(package.read_text(), original)
            self.assertEqual((licenses / f"bun-{bun_version}.md").read_text(), "license")

    def test_failed_install_can_retry_same_versions(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            package = root / "package.json"
            package.write_text((ROOT / "package.json").read_text())
            licenses = root / "src-tauri/resources/licenses"
            licenses.mkdir(parents=True)
            (licenses / "bun-9.8.7.md").write_text("license")

            with patch("fabfile.ROOT", root), patch("fabfile.subprocess.run") as process, patch("fabfile.run") as commands:
                process.return_value.stdout = "9.8.7\n"
                commands.side_effect = subprocess.CalledProcessError(1, ["bun", "install"])
                with patch("builtins.input", side_effect=["9.8.7", "8.7.6"]):
                    with self.assertRaisesRegex(Exit, "Dependency install failed"):
                        toolchain(Context())

                self.assertEqual(json.loads(package.read_text())["packageManager"], "bun@9.8.7")
                self.assertEqual(json.loads(package.read_text())["devDependencies"]["@openai/codex"], "8.7.6")
                commands.reset_mock(side_effect=True)
                with patch("builtins.input", side_effect=["", ""]):
                    toolchain(Context())
                commands.assert_has_calls([
                    call("bun", "install"),
                    call("bun", "scripts/check-toolchain.ts"),
                    call("bun", "run", "stage"),
                ])
                self.assertEqual(commands.call_count, 3)

    def test_updates_bun_and_codex_pins_without_changing_other_dependencies(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            package = root / "package.json"
            package.write_text(json.dumps({
                "packageManager": "bun@1.4.0",
                "dependencies": {"@alwith/runtime": "0.1.4"},
                "devDependencies": {"@openai/codex": "0.154.0"},
                "optionalDependencies": {
                    "@oven/bun-darwin-aarch64": "1.4.0",
                    "@oven/bun-linux-aarch64": "1.4.0",
                    "@oven/bun-linux-x64-baseline": "1.4.0",
                    "@oven/bun-windows-x64-baseline": "1.4.0",
                    "@oven/bun-windows-aarch64": "1.4.0",
                    "@openai/codex-darwin-arm64": "npm:@openai/codex@0.154.0-darwin-arm64",
                    "@openai/codex-linux-arm64": "npm:@openai/codex@0.154.0-linux-arm64",
                    "@openai/codex-linux-x64": "npm:@openai/codex@0.154.0-linux-x64",
                    "@openai/codex-win32-x64": "npm:@openai/codex@0.154.0-win32-x64",
                    "@openai/codex-win32-arm64": "npm:@openai/codex@0.154.0-win32-arm64",
                    "unrelated": "3.0.0",
                },
            }, indent=2) + "\n")

            changed = update_toolchain_pins(root, "1.4.1", "0.155.0")

            manifest = json.loads(package.read_text())
            self.assertTrue(changed)
            self.assertEqual(manifest["packageManager"], "bun@1.4.1")
            self.assertEqual(manifest["devDependencies"]["@openai/codex"], "0.155.0")
            self.assertEqual(manifest["optionalDependencies"]["@oven/bun-darwin-aarch64"], "1.4.1")
            self.assertEqual(manifest["optionalDependencies"]["@oven/bun-linux-aarch64"], "1.4.1")
            self.assertEqual(manifest["optionalDependencies"]["@openai/codex-darwin-arm64"], "npm:@openai/codex@0.155.0-darwin-arm64")
            self.assertEqual(manifest["optionalDependencies"]["@openai/codex-linux-arm64"], "npm:@openai/codex@0.155.0-linux-arm64")
            self.assertEqual(manifest["optionalDependencies"]["unrelated"], "3.0.0")
            self.assertEqual(manifest["dependencies"]["@alwith/runtime"], "0.1.4")

    def test_rejects_invalid_or_incomplete_pins_before_writing(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            package = root / "package.json"
            original = json.dumps({
                "packageManager": "bun@1.4.0",
                "devDependencies": {"@openai/codex": "0.154.0"},
                "optionalDependencies": {"@oven/bun-darwin-aarch64": "1.4.0"},
            }) + "\n"
            package.write_text(original)

            with self.assertRaisesRegex(ValueError, "version"):
                update_toolchain_pins(root, "latest", "0.155.0")
            with self.assertRaisesRegex(ValueError, "platform"):
                update_toolchain_pins(root, "1.4.1", "0.155.0")
            self.assertEqual(package.read_text(), original)

if __name__ == "__main__":
    unittest.main()
