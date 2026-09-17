#!/usr/bin/env python3
"""Compare checkout policies with tiny native programs on macOS."""

import argparse
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import threading


def run(args, cwd, env, check=True):
    result = subprocess.run(list(map(str, args)), cwd=cwd, env=env, text=True, capture_output=True)
    if check and result.returncode:
        raise RuntimeError(f"{args[0]} failed: {result.stderr}")
    return result


def sdk_environment(sdk):
    data = (sdk / "bin/ld").read_bytes().decode("utf8", errors="replace")
    for match in re.finditer(r'\{"(?:args|env|identity)"', data):
        try:
            manifest, _ = json.JSONDecoder().raw_decode(data[match.start():])
        except ValueError:
            continue
        if "executable" in manifest and "env" in manifest:
            break
    else:
        raise ValueError("Could not find the SDK linker manifest.")
    result = {}
    for key, mutation in manifest["env"]["value"]["value"].items():
        components = mutation["value"]["value"]["value"]["components"]
        result[key] = "".join(("/opt/tangram/store/" if c["kind"] == "artifact" else "") + c["value"] for c in components)
    return result


def materialize(path, env):
    result = run(["tg", "checkin", "--root", "--lock=attr", "--no-tokens", path], path.parent, env)
    artifact = re.search(r"(?:fil|dir)_[a-z0-9]+", result.stdout).group()
    run(["tg", "checkout", artifact], path.parent, env)
    store = Path("/opt/tangram/store") / artifact
    return {"id": artifact, "store_mtime_ns": store.stat().st_mtime_ns}


def record(path, source, native_stamp, cwd, env):
    (cwd / "Makefile").write_text(f"{path.relative_to(cwd)}: {source.relative_to(cwd)}\n\t@false\n")
    result = run(["/usr/bin/make", "-q", str(path.relative_to(cwd))], cwd, env, check=False)
    return {
        "mtime_ns": path.stat().st_mtime_ns,
        "native_mtime_ns": int(native_stamp.read_text()),
        "matches_native_mtime": path.stat().st_mtime_ns == int(native_stamp.read_text()),
        "make_up_to_date": result.returncode == 0,
        "make_exit": result.returncode,
        "mode": oct(path.stat().st_mode & 0o777),
    }


def churn(directory, stop, ready):
    # Only unrelated archive files change; the required libraries remain stable.
    while not stop.is_set():
        paths = [directory / f"libunrelated.a-{i}" for i in range(128)]
        for path in paths:
            path.write_bytes(b"!<arch>\n")
        ready.set()
        for path in paths:
            path.unlink(missing_ok=True)


def experiment(args):
    if sys.platform != "darwin":
        raise SystemExit("This reproduction currently targets macOS.")
    root = Path(tempfile.mkdtemp(prefix="run-", dir=args.proxies)).resolve()
    env = {k: v for k, v in os.environ.items() if not k.startswith(("TANGRAM_", "PROXY_EXPERIMENT_"))}
    env.update(sdk_environment(args.sdk))
    env["TANGRAM_URL"] = os.environ.get("TANGRAM_URL", "http+unix://%2Fopt%2Ftangram%2Fsocket")
    env["TANGRAM_LINKER_DISALLOW_MISSING_LIBRARIES"] = "true"
    env["TANGRAM_LINKER_LIBRARY_PATH_STRATEGY"] = "isolate"
    hook = root / "native-tool"
    hook.write_text(f"""#!{sys.executable}
import os, pathlib, subprocess, sys
args = sys.argv[1:]
result = subprocess.run([os.environ['PROXY_EXPERIMENT_NATIVE_TOOL'], *args])
if result.returncode == 0:
    output = args[args.index('-o') + 1] if '-o' in args else args[-1]
    pathlib.Path(os.environ['PROXY_EXPERIMENT_STAMP']).write_text(str(pathlib.Path(output).stat().st_mtime_ns))
    if 'PROXY_EXPERIMENT_HIDE_AFTER_LINK' in os.environ:
        pathlib.Path(os.environ['PROXY_EXPERIMENT_HIDE_AFTER_LINK']).rename(os.environ['PROXY_EXPERIMENT_HIDDEN_LIBRARY'])
sys.exit(result.returncode)
""")
    hook.chmod(0o755)
    env["TANGRAM_LINKER_COMMAND_PATH"] = str(hook)
    env["TANGRAM_STRIP_COMMAND_PATH"] = str(hook)
    report = {"root": str(root), "sdk": str(args.sdk), "trials": args.trials, "modes": {}}
    linker = args.proxies / "tgld"
    strip = args.proxies / "tgstrip"
    modes = [("full", "full", False), ("dependencies", "dependencies", False), ("full_restore", "full", True), ("dependencies_restore", "dependencies", True)]
    if args.production:
        modes = [("production", "dependencies", True)]
    for mode, policy, restore in modes:
        cwd = root / mode
        cwd.mkdir()
        library = cwd / "lib"
        library.mkdir()
        local_env = dict(env)
        if not args.production:
            local_env["PROXY_EXPERIMENT_CHECKOUT"] = policy
            if restore:
                local_env["PROXY_EXPERIMENT_RESTORE_MTIME"] = "1"
        stamp = cwd / "native-mtime"
        local_env.update(PROXY_EXPERIMENT_STAMP=str(stamp), PROXY_EXPERIMENT_NATIVE_TOOL="/usr/bin/clang")
        # Each run has unique bytes, while relinking within a case is deterministic.
        (cwd / "leaf.c").write_text(f'const char *nonce = "{cwd}"; int leaf(void) {{ return 42; }}\n')
        (cwd / "middle.c").write_text('int leaf(void); int middle(void) { return leaf(); }\n')
        (cwd / "main.c").write_text('int middle(void); int main(void) { return middle() != 42; }\n')
        for name in ["leaf", "middle", "main"]:
            run(["/usr/bin/clang", "-g", "-c", f"{name}.c", "-o", f"{name}.o"], cwd, local_env)
        run(["/usr/bin/clang", "-dynamiclib", "leaf.o", "-Wl,-install_name,@rpath/libleaf.dylib", "-o", "lib/libleaf.dylib"], cwd, local_env)
        shared_args = ["-dynamiclib", "middle.o", "-Wl,-install_name,@rpath/libmiddle.dylib", "-Llib", "-lleaf", "-o", "lib/libmiddle.dylib"]
        executable_args = ["main.o", "-Llib", "-lmiddle", "-o", "program"]
        output = {"timestamps": {}, "materialized": {}, "runtime": {}}
        for label, link_args, target, source in [("shared", shared_args, library / "libmiddle.dylib", cwd / "middle.o"), ("executable", executable_args, cwd / "program", cwd / "main.o")]:
            for temperature in ["cold", "warm"]:
                run([linker, *link_args], cwd, local_env)
                output["timestamps"][f"{label}_{temperature}"] = record(target, source, stamp, cwd, local_env)
                if temperature == "cold":
                    output["materialized"][label] = materialize(target, local_env)
                else:
                    current = materialize(target, local_env)
                    output["materialized"][label]["same_id_after_relink"] = current["id"] == output["materialized"][label]["id"]
                    output["materialized"][label]["warm_store_mtime_ns"] = current["store_mtime_ns"]
        # Moving the local library directory proves that runtime uses stored dependencies.
        library.rename(cwd / "hidden-lib")
        output["runtime"]["transitive_dependencies"] = run([cwd / "program"], cwd, local_env, check=False).returncode == 0
        (cwd / "hidden-lib").rename(library)
        local_env["PROXY_EXPERIMENT_NATIVE_TOOL"] = "/usr/bin/strip"
        for temperature in ["cold", "warm"]:
            run(["tg", "checkout", output["materialized"]["executable"]["id"], "--path", cwd / "program", "--force", "--lock=attr", "--no-dependencies"], cwd, local_env)
            (cwd / "program").chmod(0o751)
            run([strip, "-S", "program"], cwd, local_env)
            output["timestamps"][f"strip_{temperature}"] = record(cwd / "program", cwd / "main.o", stamp, cwd, local_env)
            materialized = materialize(cwd / "program", local_env)
            if temperature == "cold":
                output["materialized"]["strip"] = materialized
            else:
                output["materialized"]["strip"]["same_id_after_relink"] = materialized["id"] == output["materialized"]["strip"]["id"]
                output["materialized"]["strip"]["warm_store_mtime_ns"] = materialized["store_mtime_ns"]
            library.rename(cwd / "hidden-lib")
            output["runtime"][f"strip_{temperature}"] = run([cwd / "program"], cwd, local_env, check=False).returncode == 0
            (cwd / "hidden-lib").rename(library)
        local_env["PROXY_EXPERIMENT_NATIVE_TOOL"] = "/usr/bin/clang"
        # Exercise aliases, direct arguments, and a checked-out package subpath.
        (library / "middle-link.dylib").symlink_to("libmiddle.dylib")
        run([linker, "main.o", "lib/middle-link.dylib", "-Llib", "-o", "direct"], cwd, local_env)
        package = cwd / "package"
        shutil.copytree(library, package / "lib", symlinks=True)
        (package / "share").mkdir()
        (package / "share/marker").write_text("Keep the containing package context.\n")
        package_id = materialize(package, local_env)["id"]
        stored_library = Path("/opt/tangram/store") / package_id / "lib"
        run([linker, "main.o", f"-L{stored_library}", "-lmiddle", "-o", "stored"], cwd, local_env)
        library.rename(cwd / "hidden-lib")
        for target in ["direct", "stored"]:
            output["runtime"][target] = run([cwd / target], cwd, local_env, check=False).returncode == 0
        (cwd / "hidden-lib").rename(library)
        # The explicit directory-preserving policy must support libraries opened only at runtime.
        (cwd / "plugin.c").write_text("int plugin(void) { return 42; }\n")
        (cwd / "dynamic.c").write_text('#include <dlfcn.h>\nint main(void) { void *h = dlopen("libplugin.dylib", RTLD_NOW); if (!h) return 1; int (*f)(void) = dlsym(h, "plugin"); return !f || f() != 42; }\n')
        run(["/usr/bin/clang", "-dynamiclib", "plugin.c", "-Wl,-install_name,@rpath/libplugin.dylib", "-o", "lib/libplugin.dylib"], cwd, local_env)
        for strategy in ["none", "isolate"]:
            strategy_env = dict(local_env, TANGRAM_LINKER_LIBRARY_PATH_STRATEGY=strategy)
            run([linker, "dynamic.c", "-Llib", "-o", "dynamic"], cwd, strategy_env)
            library.rename(cwd / "hidden-lib")
            success = run([cwd / "dynamic"], cwd, local_env, check=False).returncode == 0
            output["runtime"][f"dlopen_{strategy}_behaves_as_expected"] = success == (strategy == "none")
            (cwd / "hidden-lib").rename(library)
        # Mach-O bundles have no install name and must remain discoverable by filename.
        run(["/usr/bin/clang", "-bundle", "plugin.c", "-o", "lib/libplugin.bundle"], cwd, local_env)
        (cwd / "dynamic.c").write_text((cwd / "dynamic.c").read_text().replace("libplugin.dylib", "libplugin.bundle"))
        run([linker, "dynamic.c", "-Llib", "-o", "bundle"], cwd, dict(local_env, TANGRAM_LINKER_LIBRARY_PATH_STRATEGY="none"))
        library.rename(cwd / "hidden-lib")
        output["runtime"]["unnamed_bundle"] = run([cwd / "bundle"], cwd, local_env, check=False).returncode == 0
        (cwd / "hidden-lib").rename(library)
        output["race"] = {}
        # This control models selecting known dependencies before taking a directory snapshot.
        selected = cwd / "selected"
        selected.mkdir()
        for name in ["libleaf.dylib", "libmiddle.dylib"]:
            shutil.copy2(library / name, selected / name)
        for scenario in ["stable", "unrelated_churn", "selected_files"]:
            link_args = ["-Lselected" if arg == "-Llib" and scenario == "selected_files" else arg for arg in executable_args]
            stop, ready = threading.Event(), threading.Event()
            thread = None
            if scenario != "stable":
                thread = threading.Thread(target=churn, args=(library, stop, ready))
                thread.start()
                ready.wait()
            trials = []
            try:
                for index in range(args.trials):
                    result = run([linker, *link_args], cwd, local_env, check=False)
                    (cwd / f"{scenario}-{index}.log").write_text(result.stderr)
                    trials.append({"exit": result.returncode, "metadata_race": "failed to get the metadata" in result.stderr and "libunrelated.a-" in result.stderr, "checkin_failure": "checkin/" in result.stderr})
            finally:
                stop.set()
                if thread:
                    thread.join()
            output["race"][scenario] = trials
        library.rename(cwd / "hidden-lib")
        selected.rename(cwd / "hidden-selected")
        output["runtime"]["selected_files"] = run([cwd / "program"], cwd, local_env, check=False).returncode == 0
        (cwd / "hidden-selected").rename(selected)
        (cwd / "hidden-lib").rename(library)
        # A missing required library must still fail; unrelated churn is not permission to ignore dependencies.
        missing_env = dict(local_env, PROXY_EXPERIMENT_HIDE_AFTER_LINK=str(library / "libmiddle.dylib"), PROXY_EXPERIMENT_HIDDEN_LIBRARY=str(cwd / "held-library.dylib"))
        # Remove the alias so it cannot keep the required library reachable.
        (library / "middle-link.dylib").unlink()
        missing = run([linker, *executable_args], cwd, missing_env, check=False)
        output["missing_required_library_fails"] = missing.returncode != 0 and "missing" in missing.stderr
        (cwd / "missing-required.log").write_text(missing.stderr)
        (cwd / "held-library.dylib").rename(library / "libmiddle.dylib")
        report["modes"][mode] = output
        (root / "results.json").write_text(json.dumps(report, indent=2) + "\n")
        print(mode, json.dumps({"timestamps": {k: {field: v[field] for field in ["make_up_to_date", "matches_native_mtime", "mode"]} for k, v in output["timestamps"].items()}, "runtime": output["runtime"], "race_failures": {k: sum(t["exit"] != 0 for t in v) for k, v in output["race"].items()}}), flush=True)
    print(f"Results: {root / 'results.json'}", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--proxies", type=Path, required=True)
    parser.add_argument("--sdk", type=Path, required=True)
    parser.add_argument("--trials", type=int, default=5)
    parser.add_argument("--production", action="store_true", help="Run the current production proxies without experimental switches.")
    arguments = parser.parse_args()
    arguments.proxies = arguments.proxies.resolve()
    arguments.sdk = arguments.sdk.resolve()
    experiment(arguments)
