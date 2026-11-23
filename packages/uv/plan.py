"""Select the distributions that uv needs to install a set of exported requirements.

Usage: plan.py <uv.lock> <output.json> <requirements.txt>...

Each requirements file is the output of `uv export`, so uv decides which packages are selected. The markers and wheel tags are evaluated for the interpreter that runs this script.
"""

import json
import sys
import tomllib
from urllib.parse import unquote, urlparse

from packaging.requirements import Requirement
from packaging.tags import sys_tags
from packaging.utils import canonicalize_name, parse_wheel_filename


def requirements(path):
    """Yield the requirements in an exported requirements file, without their hashes."""
    with open(path) as file:
        text = file.read().replace("\\\n", " ")
    for line in text.splitlines():
        line = line.split(" --hash=")[0].strip()
        if line and not line.startswith("#"):
            yield Requirement(line)


def filename(distribution):
    return unquote(urlparse(distribution["url"]).path.rsplit("/", 1)[-1])


def select(package, ranks):
    """Return the best compatible wheel of a package, or else its source distribution."""
    best = None
    for wheel in package.get("wheels", []):
        _, _, _, tags = parse_wheel_filename(filename(wheel))
        rank = min((ranks[tag] for tag in tags if tag in ranks), default=None)
        if rank is not None and (best is None or rank < best[0]):
            best = (rank, wheel)
    if best is not None:
        return best[1]
    return package.get("sdist")


def main():
    lockfile, output, *paths = sys.argv[1:]
    with open(lockfile, "rb") as file:
        lock = tomllib.load(file)
    packages = {
        (canonicalize_name(package["name"]), package.get("version")): package
        for package in lock.get("package", [])
    }
    ranks = {tag: index for index, tag in enumerate(sys_tags())}

    downloads = {}
    for path in paths:
        for requirement in requirements(path):
            if requirement.marker is not None and not requirement.marker.evaluate():
                continue
            name = canonicalize_name(requirement.name)
            if requirement.url is not None:
                sys.exit(f"error: url and git sources are not supported: {name}")
            versions = [specifier.version for specifier in requirement.specifier]
            package = packages.get((name, versions[0])) if len(versions) == 1 else None
            if package is None:
                sys.exit(f"error: the requirement {requirement} is not in uv.lock")
            registry = package["source"].get("registry", "")
            if not registry.startswith(("http://", "https://")):
                sys.exit(f"error: the source of {name} is not supported: {package['source']}")
            distribution = select(package, ranks)
            if distribution is None:
                sys.exit(f"error: uv.lock has no distribution of {name} that this interpreter can install")
            if "hash" not in distribution:
                sys.exit(f"error: the package {name} has no hash in uv.lock")
            downloads[filename(distribution)] = {
                "checksum": distribution["hash"],
                "filename": filename(distribution),
                "url": distribution["url"],
            }

    with open(output, "w") as file:
        json.dump([downloads[key] for key in sorted(downloads)], file, indent=2)


main()
