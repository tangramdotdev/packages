# /// script
# [tool.tangram.imports.ncurses]
# specifier = "ncurses"
# attributes = { source = "./ncurses.tg.ts" }
# [tool.tangram.imports.pcre2]
# specifier = "pcre2"
# attributes = { source = "./pcre2.tg.ts" }
# [tool.tangram.imports.std_assert]
# specifier = "std"
# attributes = { source = "./std", get = "assert.tg.ts" }
# [tool.tangram.imports.std_autotools]
# specifier = "std"
# attributes = { source = "./std", get = "autotools.tg.ts" }
# ///

# Python cannot import the std root module because it uses `export *`, so this module imports std submodules directly.
import ncurses
import pcre2
import std_assert
import std_autotools

metadata = {
    "homepage": "https://www.greenwoodsoftware.com/less/",
    "license": "GPL-3.0-or-later OR BSD-2-Clause",
    "name": "less",
    "repository": "https://github.com/gwsw/less",
    "version": "710",
    "tag": "less/710",
    "provides": {
        "binaries": ["less"],
    },
}


async def source() -> tg.Directory:
    name = metadata["name"]
    version = metadata["version"]
    checksum = "sha256:d1008fb78dcae1323ddab664bcb352a61f022b1b131bd8018548e021d975ec7a"
    url = f"https://www.greenwoodsoftware.com/less/{name}-{version}.tar.gz"
    archive = tg.Directory.expect(await tg.download(url, checksum, {"mode": "extract"}))
    return tg.Directory.expect(await archive.get(f"{name}-{version}"))


async def deps() -> dict[str, tg.Value.Type]:
    return {
        "ncurses": await tg.command(ncurses.build),
        "pcre2": await tg.command(pcre2.build),
    }


async def build(*args: tg.Value.Type) -> tg.Directory:
    arg = {
        "source": await source(),
        # A Python function is not a Tangram value, so pass the deps function as a command.
        "deps": await tg.command(deps),
        "phases": {
            "configure": {"args": ["--with-regex=pcre2"]},
        },
    }
    return tg.Directory.expect(await std_autotools.build(arg, *args))


default = build


async def test() -> tg.Value.Type:
    spec = await std_assert.defaultSpec(metadata)
    return await std_assert.pkg(await tg.command(build), spec)
