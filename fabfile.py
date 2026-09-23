"""Small Fabric entry points for the alwith-u development workflow."""

import json
import os
import re
import subprocess
import sys
from pathlib import Path

from fabric import task


ROOT = Path(__file__).resolve().parent
SEMVER = re.compile(r"(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?")


def run(*command: str, cwd: Path = ROOT) -> None:
    subprocess.run(command, cwd=cwd, check=True)


def update_version(root: Path, new_version: str) -> None:
    """Update the app version in the three manifests after validating all inputs."""
    if not SEMVER.fullmatch(new_version):
        raise ValueError(f"Expected a SemVer version, got {new_version!r}")

    package_path = root / "package.json"
    cargo_path = root / "src-tauri/Cargo.toml"
    lock_path = root / "src-tauri/Cargo.lock"
    package = json.loads(package_path.read_text())
    old_version = package["version"]
    cargo = cargo_path.read_text()
    lock = lock_path.read_text()

    cargo_pattern = re.compile(r'(?ms)(\A\[package\]\n(?:(?!\[).)*?^version\s*=\s*")[^"]+(".*$)')
    lock_pattern = re.compile(r'(?ms)(^\[\[package\]\]\nname = "alwith-u"\nversion = ")[^"]+(".*$)')
    cargo_match = cargo_pattern.search(cargo)
    lock_match = lock_pattern.search(lock)
    if cargo_match is None or lock_match is None:
        raise ValueError("Could not locate the alwith-u version in Cargo manifests")
    if cargo_match.group(0).split('version = "', 1)[1].split('"', 1)[0] != old_version:
        raise ValueError("package.json and Cargo.toml versions differ")
    if lock_match.group(0).split('version = "', 1)[1].split('"', 1)[0] != old_version:
        raise ValueError("package.json and Cargo.lock versions differ")

    package["version"] = new_version
    package_path.write_text(json.dumps(package, indent=2, ensure_ascii=False) + "\n")
    cargo_path.write_text(cargo_pattern.sub(lambda match: f"{match.group(1)}{new_version}{match.group(2)}", cargo, count=1))
    lock_path.write_text(lock_pattern.sub(lambda match: f"{match.group(1)}{new_version}{match.group(2)}", lock, count=1))


@task
def tauri(_context: object) -> None:
    """Stage resources before starting the dev instance."""
    run("bun", "run", "stage")
    os.chdir(ROOT)
    os.execvp("bun", ["bun", "run", "dev:tauri"])


@task
def check(_context: object) -> None:
    """Run the CI gates and Rust checks, reporting every failure."""
    steps = [
        ("stage", ["bun", "run", "stage"], ROOT),
        ("typecheck", ["bun", "run", "typecheck"], ROOT),
        ("tests", ["bun", "run", "test"], ROOT),
        ("Python tests", [sys.executable, "-B", "-m", "unittest", "discover", "-s", "scripts/__tests__"], ROOT),
        ("lint", ["bun", "run", "lint"], ROOT),
        ("knip", ["bun", "run", "knip"], ROOT),
        ("build", ["bun", "run", "build"], ROOT),
        ("rustfmt", ["cargo", "fmt", "--", "--check"], ROOT / "src-tauri"),
        ("clippy", ["cargo", "clippy", "--locked", "--all-targets", "--", "-D", "warnings"], ROOT / "src-tauri"),
        ("rust tests", ["cargo", "test", "--locked", "--lib"], ROOT / "src-tauri"),
    ]
    failures = []
    for name, command, directory in steps:
        result = subprocess.run(command, cwd=directory, check=False)
        print(f"{'✓' if result.returncode == 0 else '✗'} {name}", flush=True)
        if result.returncode != 0:
            failures.append(name)
    if failures:
        raise SystemExit(f"Checks failed: {', '.join(failures)}")


@task
def build(_context: object) -> None:
    """Build the Tauri app using its existing staging hook."""
    run("bun", "run", "tauri", "build")


@task(name="format", aliases=["f"])
def format_code(_context: object) -> None:
    """Format Rust, TypeScript, TSX, and CSS sources."""
    run("cargo", "fmt", cwd=ROOT / "src-tauri")
    run("bun", "run", "format")


@task(name="version", aliases=["v"])
def version(_context: object) -> None:
    """Set the app version in package.json and both Cargo manifests."""
    current = json.loads((ROOT / "package.json").read_text())["version"]
    new_version = input(f"New version [{current}]: ").strip()
    if not new_version or new_version == current:
        print("Version unchanged")
        return
    update_version(ROOT, new_version)
    print(f"Version updated: {current} → {new_version}")
