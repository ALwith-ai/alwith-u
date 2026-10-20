"""Small Fabric entry points for the alwith-u development workflow."""

import json
import os
import re
import shutil
import subprocess
import sys
lazy import tomllib
lazy import urllib.request
from pathlib import Path

from fabric import task
lazy from InquirerPy import inquirer
lazy from InquirerPy.base.control import Choice
lazy from invoke import Context
lazy from invoke.exceptions import Exit


ROOT = Path(__file__).resolve().parent
SEMVER_NUMBER = r"(?:0|[1-9][0-9]*)"
SEMVER_PRERELEASE = rf"(?:{SEMVER_NUMBER}|[0-9]*[A-Za-z-][0-9A-Za-z-]*)"
SEMVER = re.compile(
    rf"{SEMVER_NUMBER}\.{SEMVER_NUMBER}\.{SEMVER_NUMBER}"
    rf"(?:-{SEMVER_PRERELEASE}(?:\.{SEMVER_PRERELEASE})*)?"
    r"(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?"
)
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
    if new_version == old_version:
        return

    package["version"] = new_version
    updated = {
        package_path: json.dumps(package, indent=2, ensure_ascii=False) + "\n",
        cargo_path: cargo_pattern.sub(lambda match: f"{match.group(1)}{new_version}{match.group(2)}", cargo, count=1),
        lock_path: lock_pattern.sub(lambda match: f"{match.group(1)}{new_version}{match.group(2)}", lock, count=1),
    }
    originals = {path: path.read_bytes() for path in updated}
    attempted: list[Path] = []
    try:
        for path, content in updated.items():
            # A failed write may already have truncated the file; include it in rollback.
            attempted.append(path)
            path.write_text(content)
    except (OSError, KeyboardInterrupt) as error:
        failures: list[str] = []
        for path in reversed(attempted):
            try:
                if path.read_bytes() != originals[path]:
                    path.write_bytes(originals[path])
            except OSError as rollback_error:
                failures.append(f"{path}: {rollback_error}")
        if failures:
            raise RuntimeError("Version update failed; could not restore " + "; ".join(failures)) from error
        raise


def update_toolchain_pins(root: Path, bun_version: str, codex_version: str) -> bool:
    """Update the bundled Bun and Codex pins only after checking the existing platform pins.

    `packageManager` (the Bun that builds the app) is left alone: it changes with the developer's toolchain,
    not with what the app ships.
    """
    if not PIN_VERSION.fullmatch(bun_version) or not PIN_VERSION.fullmatch(codex_version):
        raise ValueError("Bun and Codex version must be exact X.Y.Z versions")

    package_path = root / "package.json"
    manifest = json.loads(package_path.read_text())
    optional = manifest["optionalDependencies"]
    old_bun = optional.get(BUN_PLATFORM_PACKAGES[0], "")
    if not PIN_VERSION.fullmatch(old_bun):
        raise ValueError("Bun platform pins must be an exact version")
    dev_dependencies = manifest["devDependencies"]
    old_codex = dev_dependencies["@openai/codex"]
    if not PIN_VERSION.fullmatch(old_codex):
        raise ValueError("@openai/codex must pin an exact version")
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
    dev_dependencies["@openai/codex"] = codex_version
    for name in BUN_PLATFORM_PACKAGES:
        optional[name] = bun_version
    for name in CODEX_PLATFORM_PACKAGES:
        platform = name.removeprefix("@openai/codex-")
        optional[name] = f"npm:@openai/codex@{codex_version}-{platform}"
    package_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
    return True


def check_toolchain_prerequisites(root: Path, bun_version: str) -> None:
    """Prepare the bundled Bun's versioned licence before changing version pins.

    The bundled Bun ships to users from the pinned `@oven/bun-*` packages; the Bun on this machine only
    builds the app (`packageManager`) and is never required to match it.
    """
    if not PIN_VERSION.fullmatch(bun_version):
        raise ValueError("Bun version must be an exact X.Y.Z version")
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


def check_tauri_versions(root: Path) -> None:
    """Require installed Tauri NPM packages to match their resolved Rust minors."""
    manifest = json.loads((root / "package.json").read_text())
    npm_dependencies = manifest.get("dependencies", {}) | manifest.get("devDependencies", {})
    npm_packages = [
        name
        for name in npm_dependencies
        if name == "@tauri-apps/api" or name.startswith("@tauri-apps/plugin-")
    ]
    cargo_lock = tomllib.loads((root / "src-tauri/Cargo.lock").read_text())
    cargo_packages = cargo_lock.get("package", [])
    mismatches = []

    for npm_name in npm_packages:
        crate_name = "tauri" if npm_name == "@tauri-apps/api" else f"tauri-{npm_name.removeprefix('@tauri-apps/')}"
        rust_versions = [package["version"] for package in cargo_packages if package["name"] == crate_name]
        if len(rust_versions) != 1:
            raise ValueError(f"Expected one resolved {crate_name} package, found {len(rust_versions)}")
        npm_manifest = json.loads((root / "node_modules" / npm_name / "package.json").read_text())
        npm_version = npm_manifest["version"]
        rust_version = rust_versions[0]
        if not SEMVER.fullmatch(npm_version) or not SEMVER.fullmatch(rust_version):
            raise ValueError(f"Invalid resolved Tauri version: {crate_name} {rust_version}, {npm_name} {npm_version}")
        if npm_version.split(".")[:2] != rust_version.split(".")[:2]:
            mismatches.append(f"{crate_name} (v{rust_version}) : {npm_name} (v{npm_version})")

    if mismatches:
        raise ValueError("Found version mismatched Tauri packages:\n" + "\n".join(mismatches))


def semver_key(version: str) -> tuple:
    """Order SemVer strings by precedence: releases above their prereleases, numeric identifiers below text."""
    core, _, prerelease = version.split("+", 1)[0].partition("-")
    numbers = tuple(int(part) for part in core.split("."))
    if not prerelease:
        return numbers, (1,)
    identifiers = tuple((0, int(part), "") if part.isdigit() else (1, 0, part) for part in prerelease.split("."))
    return numbers, (0, identifiers)


def direct_crates(root: Path) -> dict[str, tuple[str, str]]:
    """Map each registry crate the app declares to its requirement and resolved version."""
    manifest = tomllib.loads((root / "src-tauri/Cargo.toml").read_text())
    lock = tomllib.loads((root / "src-tauri/Cargo.lock").read_text())
    tables = [manifest.get(kind, {}) for kind in ("dependencies", "build-dependencies", "dev-dependencies")]
    for target in manifest.get("target", {}).values():
        tables += [target.get(kind, {}) for kind in ("dependencies", "build-dependencies", "dev-dependencies")]
    requirements = {}
    for table in tables:
        for key, spec in table.items():
            spec = {"version": spec} if isinstance(spec, str) else spec
            # Path and git dependencies are vendored or pinned by source, not by registry releases.
            if "path" in spec or "git" in spec or "version" not in spec:
                continue
            requirements[spec.get("package", key)] = spec["version"]

    app = manifest["package"]["name"]
    packages = lock.get("package", [])
    versions: dict[str, list[str]] = {}
    for package in packages:
        versions.setdefault(package["name"], []).append(package["version"])
    resolved = {}
    for entry in next(package for package in packages if package["name"] == app).get("dependencies", []):
        name, _, version = entry.partition(" ")
        if name in requirements:
            resolved[name] = version or versions[name][0]
    return {name: (requirements[name], resolved[name]) for name in requirements if name in resolved}


def crate_releases(name: str) -> list[str]:
    """Read a crate's unyanked versions from the crates.io sparse index."""
    lowered = name.lower()
    if len(lowered) <= 2:
        prefix = str(len(lowered))
    elif len(lowered) == 3:
        prefix = f"3/{lowered[0]}"
    else:
        prefix = f"{lowered[:2]}/{lowered[2:4]}"
    with urllib.request.urlopen(f"https://index.crates.io/{prefix}/{lowered}", timeout=15) as response:
        lines = response.read().decode("utf-8").splitlines()
    return [entry["vers"] for entry in map(json.loads, filter(None, lines)) if not entry.get("yanked")]


def report_outdated_crates(root: Path) -> None:
    """Print declared crates whose newest release is beyond what Cargo may resolve.

    Reads the manifests instead of rewriting them, so vendored patches with exact pins cannot break the report.
    """
    from concurrent.futures import ThreadPoolExecutor

    crates = direct_crates(root)

    def newest(name: str) -> str | None:
        current = crates[name][1]
        candidates = [version for version in crate_releases(name) if "-" in current or "-" not in version]
        latest = max(candidates, key=semver_key, default=None)
        return latest if latest and semver_key(latest) > semver_key(current) else None

    rows, failures = [], []
    with ThreadPoolExecutor(max_workers=16) as pool:
        futures = {name: pool.submit(newest, name) for name in sorted(crates)}
    for name, future in futures.items():
        try:
            latest = future.result()
        except (OSError, UnicodeError, ValueError) as error:
            failures.append(f"{name} ({error})")
            continue
        if latest:
            rows.append((name, crates[name][0], crates[name][1], latest))
    if rows:
        widths = [max(len(row[column]) for row in [("Crate", "Requirement", "Current", "Latest"), *rows]) for column in range(4)]
        for row in [("Crate", "Requirement", "Current", "Latest"), *rows]:
            print("  ".join(cell.ljust(width) for cell, width in zip(row, widths)).rstrip())
    else:
        print("All declared crates are on their newest releases.")
    if failures:
        print("Could not check: " + ", ".join(failures), file=sys.stderr)


@task
def tauri(_context: object) -> None:
    """Start the dev instance through Tauri's build hooks."""
    os.chdir(ROOT)
    os.execvp("bun", ["bun", "run", "dev:tauri"])


@task
def story(_context: object) -> None:
    """Select Storybook preview, browser tests, or a static share archive."""
    action = inquirer.select(
        message="Storybook",
        choices=[
            Choice("dev", name="Start UI preview"),
            Choice("test", name="Run all story browser tests"),
            Choice("watch", name="Watch and rerun browser tests"),
            Choice("browsers", name="Install test browser"),
            Choice("build", name="Build static preview and share ZIP"),
        ],
    ).execute()
    if action == "build":
        build_story_archive()
        return
    commands = {
        "dev": ["bun", "run", "storybook"],
        "test": ["bun", "run", "storybook:test"],
        "watch": ["bun", "x", "vitest", "--config", ".storybook/vitest.config.ts"],
        "browsers": ["bun", "x", "playwright", "install", "chromium"],
    }
    run(*commands[action])


def build_story_archive() -> None:
    """Build and zip the static Storybook site for sharing without the repository."""
    run("bun", "run", "storybook:check")
    run("bun", "run", "storybook:build")
    site = ROOT / "storybook-static"
    if not (site / "index.html").is_file():
        raise Exit("Storybook build did not produce index.html", code=1)
    if any(site.rglob("*.map")):
        raise Exit("Source maps found in Storybook output; refusing to package", code=1)
    output = ROOT / "dist"
    output.mkdir(exist_ok=True)
    archive = shutil.make_archive(str(output / "alwith-u-storybook"), "zip", root_dir=site)
    print(f"Static site: {site}")
    print(f"Share archive: {archive}")
    print("Extract and serve with a static web server. Browser JavaScript remains inspectable.")


def workspace_packages() -> list[str]:
    """`-p` arguments for cargo fmt: every workspace member. Not `--all`, which follows path
    dependencies into the third-party snapshots under patches/ that the workspace excludes."""
    metadata = subprocess.run(
        ("cargo", "metadata", "--no-deps", "--format-version", "1"),
        cwd=ROOT / "src-tauri",
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    return [arg for package in json.loads(metadata)["packages"] for arg in ("-p", package["name"])]


@task
def check(_context: object) -> None:
    """Run the CI gates shared by Desktop, U and Board, reporting every failure at the end.

    Same table in all three repos: types, lint (`bun lint`), dead code, tests, then the Rust side
    (rustfmt, clippy, the whole workspace's compile surface, lib tests). Repo-specific gates follow."""
    steps = [
        ("types", ["bun", "run", "typecheck"], ROOT),
        ("lint", ["bun", "run", "lint"], ROOT),
        ("knip", ["bun", "run", "knip"], ROOT),
        ("tests", ["bun", "run", "test"], ROOT),
        ("rustfmt", ["cargo", "fmt", *workspace_packages(), "--", "--check"], ROOT / "src-tauri"),
        ("clippy", ["cargo", "clippy", "--locked", "--workspace", "--all-targets", "--", "-D", "warnings"], ROOT / "src-tauri"),
        ("rust compile surface", ["cargo", "check", "--locked", "--workspace", "--all-targets"], ROOT / "src-tauri"),
        ("rust tests", ["cargo", "test", "--locked", "--workspace", "--lib"], ROOT / "src-tauri"),
        ("Python tests", [sys.executable, "-B", "-m", "unittest", "discover", "-s", "scripts/__tests__"], ROOT),
        ("toolchain", ["bun", "run", "check:toolchain"], ROOT),
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
def build(context: Context) -> None:
    """Build the application with Tauri."""
    with context.cd(str(ROOT)):
        context.run("bun tauri build")


@task(aliases=["u"])
def upgrade(context: Context) -> None:
    """Update dependencies within declared ranges and report newer releases."""
    with context.cd(str(ROOT)):
        # Cargo path dependencies live in node_modules, including their Rust manifests.
        # Restore the locked packages first so a fresh checkout can run this task.
        context.run("bun install --frozen-lockfile")
        context.run("bun outdated")
        context.run("bun update")
        # Resolve Cargo only after Bun updates: shared packages may change Rust dependencies.
        with context.cd("src-tauri"):
            context.run("cargo update")
        # Report releases outside Cargo's declared ranges without upgrading them.
        report_outdated_crates(ROOT)
        # Compare the final installed JavaScript packages with the updated Cargo lockfile.
        try:
            check_tauri_versions(ROOT)
        except (KeyError, OSError, ValueError) as error:
            raise Exit(f"Tauri version check failed: {error}", code=1) from None


@task
def clean(context: Context) -> None:
    """Remove build output: unused Rust artifacts, the whole target directory, or empty directories."""
    mode = inquirer.select(
        "How to clean:",
        [
            Choice("sweep", "cargo sweep (artifacts untouched for 30 days or from uninstalled toolchains)"),
            Choice("full", "cargo clean (whole target directory; next build recompiles everything)"),
            Choice("dirs", "empty directories only"),
        ],
    ).execute()
    with context.cd(str(ROOT)):
        if mode == "sweep":
            if not context.run("command -v cargo-sweep", warn=True, hide=True).ok:
                context.run("cargo install cargo-sweep")
            with context.cd("src-tauri"):
                context.run("cargo sweep --installed")
                context.run("cargo sweep --time 30")
        elif mode == "full":
            with context.cd("src-tauri"):
                context.run("cargo clean")
        context.run("find . -type d -empty -print -delete")


@task(name="format", aliases=["f"])
def format_code(_context: object) -> None:
    """Format Rust, TypeScript, TSX, and CSS sources: rustfmt, then Bun's built-in `bun fmt`
    (configured in bunfig.toml's [fmt]; import sorting and Tailwind class sorting are its built-in options)."""
    run("cargo", "fmt", *workspace_packages(), cwd=ROOT / "src-tauri")
    run("bun", "fmt")
    print("✓ Formatted")


@task(name="version", aliases=["v"])
def version(_context: object) -> None:
    """Set the app version in package.json and both Cargo manifests."""
    try:
        current = json.loads((ROOT / "package.json").read_text())["version"]
        new_version = input(f"New version [{current}]: ").strip() or current
        update_version(ROOT, new_version)
    except (ValueError, RuntimeError, OSError) as error:
        raise Exit(f"Version update failed: {error}", code=1) from None
    if new_version == current:
        print("Version unchanged")
        return
    print(f"Version updated: {current} → {new_version}")


@task
def toolchain(_context: object) -> None:
    """Update the bundled Bun and Codex pins, then install and stage the toolchain."""
    try:
        manifest = json.loads((ROOT / "package.json").read_text())
        current_bun = manifest["optionalDependencies"][BUN_PLATFORM_PACKAGES[0]]
        current_codex = manifest["devDependencies"]["@openai/codex"]
        bun_version = input(f"Bundled Bun version [{current_bun}]: ").strip() or current_bun
        codex_version = input(f"Codex version [{current_codex}]: ").strip() or current_codex
        check_toolchain_prerequisites(ROOT, bun_version)
        update_toolchain_pins(ROOT, bun_version, codex_version)
        steps = [
            ("Dependency install", ("bun", "install")),
            ("Toolchain check", ("bun", "scripts/check-toolchain.ts")),
            ("Sidecar staging", ("bun", "run", "stage")),
        ]
        # Hasgard CLI drives the dev instance (MCP, smoke scripts); the same crates.io release everywhere.
        if shutil.which("tauri-hasgard") is None:
            steps.append(("Hasgard CLI install", ("cargo", "install", "tauri-hasgard-cli")))
        for step, command in steps:
            try:
                run(*command)
            except subprocess.CalledProcessError as error:
                raise RuntimeError(f"{step} failed; fix the cause and rerun fab toolchain with the same versions") from error
    except (ValueError, RuntimeError, OSError) as error:
        raise Exit(f"Toolchain failed: {error}", code=1) from None
    print(f"Toolchain pins and staged binaries verified: bundled Bun {bun_version}, Codex {codex_version}")
