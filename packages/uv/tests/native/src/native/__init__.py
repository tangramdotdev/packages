import markupsafe
from markupsafe import _speedups


def main() -> None:
    print(markupsafe.escape("<uv>"), _speedups.__name__)
