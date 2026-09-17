#!/usr/bin/env python3
"""Build experimental proxies without modifying the production sources."""

import argparse
import io
from pathlib import Path
import shutil
import subprocess
import tarfile


def replace(path, old, new):
    source = path.read_text()
    assert source.count(old) == 1, (path, old)
    path.write_text(source.replace(old, new))


def prepare(output):
    root = Path(__file__).resolve().parents[2]
    archive = subprocess.check_output(["git", "archive", "227219e9", "packages/std/Cargo.toml", "packages/std/Cargo.lock", "packages/std/packages"], cwd=root)
    with tarfile.open(fileobj=io.BytesIO(archive)) as files:
        files.extractall(output / "baseline", filter="data")
    source = output / "baseline/packages/std"
    workspace = output / "workspace"
    workspace.mkdir(parents=True, exist_ok=True)
    for name in ["Cargo.toml", "Cargo.lock"]:
        shutil.copy2(source / name, workspace / name)
    shutil.copytree(source / "packages", workspace / "packages", dirs_exist_ok=True)
    common = workspace / "packages/common/src/lib.rs"
    replace(common, "\tlet dependencies = artifact.dependencies().await?;\n\tif !dependencies.is_empty() {\n\t\tcheckout_artifacts(dependencies).await?;\n\t}", """\tif std::env::var("PROXY_EXPERIMENT_CHECKOUT").as_deref() == Ok("full") {
\t\tcheckout_artifact(artifact.clone()).await?;
\t} else {
\t\tlet dependencies = artifact.dependencies().await?;
\t\tif !dependencies.is_empty() {
\t\t\tcheckout_artifacts(dependencies).await?;
\t\t}
\t}""")
    linker = workspace / "packages/tgld/src/main.rs"
    replace(linker, "let (output_file, original_permissions) = {", "let (output_file, original_permissions, original_modified) = {")
    replace(linker, "(output_file, original_permissions)\n\t};", "(output_file, original_permissions, original_metadata.modified().unwrap())\n\t};")
    strip = workspace / "packages/tgstrip/src/main.rs"
    replace(strip, "\t\t\t// Check in the result.", "\t\t\tlet original_modified = std::fs::metadata(&local_executable_path).unwrap().modified().unwrap();\n\n\t\t\t// Check in the result.")
    for path, target, indent in [(linker, "output_path", "\t\t"), (strip, "canonical_target_path", "\t\t\t")]:
        old = f"{indent}common::checkout_artifact_to_path(artifact, {target}.clone()).await?;"
        replace(path, old, old + f"""
{indent}if std::env::var_os("PROXY_EXPERIMENT_RESTORE_MTIME").is_some() {{
{indent}\tstd::fs::File::open(&{target}).unwrap().set_modified(original_modified).unwrap();
{indent}}}""")
    target = root / "packages/std/target"
    subprocess.run(["cargo", "build", "--manifest-path", str(workspace / "Cargo.toml"), "--target-dir", str(target), "--package", "tgld", "--package", "tgstrip", "--offline"], check=True)
    for name in ["tgld", "tgstrip"]:
        shutil.copy2(target / "debug" / name, output / name)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    prepare(parser.parse_args().output.resolve())
