"""Small Fabric entry points for the alwith-u development workflow."""

import json
import os
import re
import subprocess
import sys
import urllib.request
from pathlib import Path

from fabric import task
from invoke.exceptions import Exit


ROOT = Path(__file__).resolve().parent
SEMVER = re.compile(r"(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?")
PIN_VERSION = re.compile(r"(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)")
BUN_PLATFORM_PACKAGES = (
    "@oven/bun-darwin-aarch64",
    "@oven/bun-linux-aarch64",
    "@oven/bun-linux-x64-baseline",
    "@oven/bun-windows-x64-baseline",
    "@oven/bun-windows-aarch64",
)
CODEX_PLATFORM_PACKAGES = (
    "@openai/codex-darwin-arm64",
    "@openai/codex-linux-x64",
    "@openai/codex-linux-arm64",
    "@openai/codex-win32-x64",
    "@openai/codex-win32-arm64",
)


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


def update_toolchain_pins(root: Path, bun_version: str, codex_version: str) -> bool:
    """Update the direct toolchain pins only after checking the existing platform pins."""
    if not PIN_VERSION.fullmatch(bun_version) or not PIN_VERSION.fullmatch(codex_version):
        raise ValueError("Bun and Codex version must be exact X.Y.Z versions")

    package_path = root / "package.json"
    manifest = json.loads(package_path.read_text())
    manager = manifest["packageManager"]
    if not manager.startswith("bun@") or not PIN_VERSION.fullmatch(manager[4:]):
        raise ValueError("packageManager must pin an exact Bun version")
    old_bun = manager[4:]
    dev_dependencies = manifest["devDependencies"]
    old_codex = dev_dependencies["@openai/codex"]
    if not PIN_VERSION.fullmatch(old_codex):
        raise ValueError("@openai/codex must pin an exact version")
    optional = manifest["optionalDependencies"]
    for name in BUN_PLATFORM_PACKAGES:
        if optional.get(name) != old_bun:
            raise ValueError(f"Bun platform pin {name} does not match {old_bun}")
    for name in CODEX_PLATFORM_PACKAGES:
        platform = name.removeprefix("@openai/codex-")
        expected = f"npm:@openai/codex@{old_codex}-{platform}"
        if optional.get(name) != expected:
            raise ValueError(f"Codex platform pin {name} does not match {expected}")

    if bun_version == old_bun and codex_version == old_codex:
        return False
    manifest["packageManager"] = f"bun@{bun_version}"
    dev_dependencies["@openai/codex"] = codex_version
    for name in BUN_PLATFORM_PACKAGES:
        optional[name] = bun_version
    for name in CODEX_PLATFORM_PACKAGES:
        platform = name.removeprefix("@openai/codex-")
        optional[name] = f"npm:@openai/codex@{codex_version}-{platform}"
    package_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
    return True


def check_toolchain_prerequisites(root: Path, bun_version: str) -> None:
    """Prepare a versioned Bun licence before changing version pins."""
    if not PIN_VERSION.fullmatch(bun_version):
        raise ValueError("Bun version must be an exact X.Y.Z version")
    try:
        installed = subprocess.run(["bun", "--version"], cwd=root, check=True, capture_output=True, text=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError) as error:
        raise RuntimeError(f"Cannot check local Bun; install Bun {bun_version} first") from error
    if installed != bun_version:
        raise ValueError(f"Local Bun is {installed}; install Bun {bun_version} before running fab toolchain")
    license_path = root / "src-tauri/resources/licenses" / f"bun-{bun_version}.md"
    if license_path.is_file():
        return
    source_url = f"https://github.com/oven-sh/bun/blob/bun-v{bun_version}/LICENSE.md"
    raw_url = f"https://raw.githubusercontent.com/oven-sh/bun/bun-v{bun_version}/LICENSE.md"
    try:
        with urllib.request.urlopen(raw_url, timeout=15) as response:
            content = response.read().decode("utf-8")
    except (OSError, UnicodeError) as error:
        raise RuntimeError(f"Could not download Bun {bun_version} licence from {source_url}") from error
    if not content.strip():
        raise ValueError(f"Empty Bun {bun_version} licence from {source_url}")
    license_path.parent.mkdir(parents=True, exist_ok=True)
    with license_path.open("x", encoding="utf-8") as file:
        file.write(f"Source: {source_url}\n\n{content}")


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


@task
def toolchain(_context: object) -> None:
    """Update Bun and Codex pins, then install and stage the toolchain."""
    try:
        manifest = json.loads((ROOT / "package.json").read_text())
        current_bun = manifest["packageManager"].removeprefix("bun@")
        current_codex = manifest["devDependencies"]["@openai/codex"]
        bun_version = input(f"Bun version [{current_bun}]: ").strip() or current_bun
        codex_version = input(f"Codex version [{current_codex}]: ").strip() or current_codex
        check_toolchain_prerequisites(ROOT, bun_version)
        update_toolchain_pins(ROOT, bun_version, codex_version)
        for step, command in (
            ("Dependency install", ("bun", "install")),
            ("Toolchain check", ("bun", "scripts/check-toolchain.ts")),
            ("Sidecar staging", ("bun", "run", "stage")),
        ):
            try:
                run(*command)
            except subprocess.CalledProcessError as error:
                raise RuntimeError(f"{step} failed; fix the cause and rerun fab toolchain with the same versions") from error
    except (ValueError, RuntimeError, OSError) as error:
        raise Exit(f"Toolchain failed: {error}", code=1) from None
    print(f"Toolchain pins and staged binaries verified: Bun {bun_version}, Codex {codex_version}")
