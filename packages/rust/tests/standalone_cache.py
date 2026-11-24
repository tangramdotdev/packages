"""Test standalone compiler caching and Cargo target reuse."""

from __future__ import annotations

import json
import os
import re
import subprocess
import tempfile
import time
from pathlib import Path


def main() -> None:
    packages = Path.cwd() / "packages"
    cargo = packages / "rust/cargo.tg.ts"
    if not cargo.is_file():
        raise RuntimeError("run this test from the packages repository root")
    host = next(
        line.removeprefix("host: ")
        for line in subprocess.check_output(["rustc", "-vV"], text=True).splitlines()
        if line.startswith("host: ")
    )
    sdk = ', sdk: { linker: "mold" }' if "linux" in host else ""
    files = {
        "Cargo.toml": """
[package]
name = "standalone-cache"
version = "0.1.0"
edition = "2024"
[dependencies]
fixture = { path = "fixture" }
""",
        "Cargo.lock": """
version = 4
[[package]]
name = "fixture"
version = "0.1.0"
[[package]]
name = "standalone-cache"
version = "0.1.0"
dependencies = ["fixture"]
""",
        "fixture/Cargo.toml": """
[package]
name = "fixture"
version = "0.1.0"
edition = "2024"
""",
        "fixture/src/lib.rs": 'pub fn message() -> &\'static str { "original" }',
        "shared/message.txt": "shared",
        "build.rs": """
fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    let directory = std::path::PathBuf::from(std::env::var("OUT_DIR").unwrap());
    let directory = directory.join("nested");
    std::fs::create_dir_all(&directory).unwrap();
    std::fs::write(directory.join("generated.txt"), "generated").unwrap();
    let manifest =
        std::path::PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let file = directory.join("generated.txt");
    let common = manifest.components().zip(file.components())
        .take_while(|(left, right)| left == right).count();
    let mut relative = std::path::PathBuf::new();
    for _ in manifest.components().skip(common) { relative.push(".."); }
    for component in file.components().skip(common) { relative.push(component); }
    println!("cargo:rustc-env=GENERATED_PATH={}", relative.display());
}
""",
        "src/main.rs": """
#[cfg(not(standalone_test))]
compile_error!("Cargo's configured Rust flags must be preserved");
fn main() {
    let generated = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"), "/", env!("GENERATED_PATH")
    ));
    println!("{}: {}: {}", fixture::message(), generated, fixture::shared());
}
""",
        ".cargo/config.toml": """
[build]
target-dir = "target/reused directory"
[target.'cfg(all())']
rustflags = ["--cfg=standalone_test"]
""",
        ".gitignore": "/target\n",
        ".tangramignore": "/target\n",
        "tangram.ts": f"""
import * as cargo from {json.dumps(str(cargo))};
import * as std from {json.dumps(str(packages / "std/tangram.ts"))};
import source from "." with {{ type: "directory" }};
export default () => cargo.build({{
    source, targetDir: true, standalone: true, proxy: true,
    profile: "dev", parallelJobs: 2{sdk}
}});
export const binary = (file: tg.File) => std.file.standalone(file, {json.dumps(host)});
""",
    }
    files["fixture/src/lib.rs"] += """
pub fn shared() -> &'static str {
    include_str!("../../shared/message.txt")
}
"""
    environment = dict(os.environ)
    for name in ["CARGO_TARGET_DIR", "CARGO_ENCODED_RUSTFLAGS", "RUSTFLAGS"]:
        environment.pop(name, None)
    with tempfile.TemporaryDirectory(prefix="tangram-standalone-cache-") as temporary:
        root = Path(temporary)
        for name, contents in files.items():
            path = root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(contents)

        def build(label: str, expected: str, target: Path | None = None) -> None:
            started = time.monotonic()
            log_path = root / "target" / f"{label}.log"
            log_path.parent.mkdir(exist_ok=True)
            with log_path.open("w") as log:
                command = subprocess.check_output(
                    ["tg", "build", ".", "--retry"],
                    cwd=root,
                    env=environment,
                    stderr=log,
                    text=True,
                ).strip()
                args = ["tg", "run", "--env-string", "TGRUSTC_RETRY=1"]
                if target is not None:
                    args.extend(["--env-string", f"CARGO_TARGET_DIR={target}"])
                result = subprocess.run(
                    [*args, command],
                    cwd=root,
                    env=environment,
                    stdout=log,
                    stderr=subprocess.STDOUT,
                    check=False,
                )
            if result.returncode != 0:
                diagnostic = re.sub(
                    r"tokens[^\s]+", "tokens=[redacted]", log_path.read_text()
                )
                raise RuntimeError(diagnostic)
            elapsed = time.monotonic() - started
            target = target or root / "target/reused directory"
            binary = target / host / "debug/standalone-cache"
            artifact = (
                subprocess.check_output(
                    ["tg", "checkin", "--no-tokens", str(binary)], text=True
                )
                .strip()
                .split("?", 1)[0]
            )
            exported = root / "target" / f"export-{label}"
            subprocess.run(
                [
                    "tg",
                    "build",
                    ".#binary",
                    "--retry",
                    "--arg-value",
                    artifact,
                    f"--checkout={exported}",
                ],
                cwd=root,
                env=environment,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=True,
            )
            output = subprocess.check_output([str(exported)], text=True).strip()
            assert output == expected, (output, expected)
            print(f"{label}: {elapsed:.2f}s; {output}", flush=True)

        build("initial", "original: generated: shared")
        build("unchanged", "original: generated: shared")
        source = root / "fixture/src/lib.rs"
        source.write_text(source.read_text().replace("original", "edited"))
        build("source-edit", "edited: generated: shared")
        (root / "shared/message.txt").write_text("changed")
        build("included-file-edit", "edited: generated: changed")
        script = root / "build.rs"
        script.write_text(script.read_text().replace('"generated"', '"updated"'))
        build("build-script-edit", "edited: updated: changed")
        build("unchanged-after-edit", "edited: updated: changed")
        build("fresh-target", "edited: updated: changed", root / "target/fresh")


if __name__ == "__main__":
    main()
