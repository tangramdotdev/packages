"""Select the distributions that uv needs to install a set of exported lock files.

Usage: plan.py <output.json> <pylock.toml>...

Each lock file is the output of `uv export --format pylock.toml`, so uv decides which packages are selected, and each package keeps the index, URLs, and hashes that uv locked for it. The markers and wheel tags are evaluated for the interpreter that runs this script. The uv settings that choose between wheels and source distributions are read from the current directory.
"""

import json
import os
import sys
import tomllib

from packaging.pylock import PackageDirectory, PackageSdist, PackageWheel, Pylock
from packaging.tags import compatible_tags, cpython_tags, mac_platforms, sys_tags
from packaging.utils import canonicalize_name, parse_wheel_filename


def fail(message):
    sys.exit(f"error: {message}")


def load(path):
    try:
        with open(path, "rb") as file:
            return tomllib.load(file)
    except FileNotFoundError:
        return None


def supported_tags():
    """Return the tags that the interpreter supports, best first. On macOS, the deployment target bounds the platform version instead of the version of the machine that runs the build."""
    target = os.environ.get("MACOSX_DEPLOYMENT_TARGET")
    if sys.platform != "darwin" or not target:
        return list(sys_tags())
    major, minor, *_ = [int(part) for part in target.split(".")] + [0]
    platforms = list(mac_platforms((major, minor)))
    return [*cpython_tags(platforms=platforms), *compatible_tags(platforms=platforms)]


def settings():
    """Return the uv settings of the project. A `uv.toml` file takes precedence over the `tool.uv` table of `pyproject.toml`."""
    options = load("uv.toml")
    if options is None:
        options = (load("pyproject.toml") or {}).get("tool", {}).get("uv", {})

    def predicate(key):
        everything = options.get(key, False)
        names = {canonicalize_name(name) for name in options.get(f"{key}-package", [])}
        return lambda name: everything or name in names

    return predicate("no-binary"), predicate("no-build")


def main():
    output, *paths = sys.argv[1:]
    tags = supported_tags()
    ranks = {}
    for index, tag in enumerate(tags):
        ranks.setdefault(tag, index)
    no_binary, no_build = settings()

    def rank(wheel):
        wheel_tags = parse_wheel_filename(wheel.filename)[-1]
        return min((ranks[tag] for tag in wheel_tags if tag in ranks), default=None)

    downloads = {}
    for path in paths:
        lock = Pylock.from_dict(load(path))
        for package, artifact in lock.select(tags=tags, prefer_sdist_predicate=no_binary):
            name = package.name
            if isinstance(artifact, PackageDirectory):
                continue
            if isinstance(artifact, PackageSdist):
                if package.wheels and not no_binary(name):
                    wheels = ", ".join(wheel.filename for wheel in package.wheels)
                    print(f"note: no wheel of {name} is compatible with this interpreter, so its source distribution is used. The wheels are {wheels}.", file=sys.stderr)
                if no_build(name):
                    fail(f"the package {name} must be built from source, but the uv settings do not allow it to be built")
                artifacts = [artifact]
            elif isinstance(artifact, PackageWheel):
                # Keep every wheel that is as compatible as the best one, so that uv chooses between them, for example by build number.
                best = rank(artifact)
                artifacts = [wheel for wheel in package.wheels if rank(wheel) == best]
            else:
                fail(f"the package {name} comes from a git repository or an archive, which is not supported")
            for artifact in artifacts:
                filename = artifact.filename
                url = artifact.url
                if url is None or not url.startswith(("http://", "https://")):
                    fail(f"the distribution {filename} has no URL that can be downloaded")
                if "sha256" not in artifact.hashes:
                    fail(f"the distribution {filename} has no sha256 hash")
                download = {
                    "checksum": f"sha256:{artifact.hashes['sha256']}",
                    "filename": filename,
                    "url": url,
                }
                if downloads.setdefault(filename, download) != download:
                    fail(f"the distribution {filename} is locked with two different sources")

    with open(output, "w") as file:
        json.dump([downloads[key] for key in sorted(downloads)], file, indent=2)


main()
