# /// script
# [tool.tangram.imports.ncurses]
# specifier = "ncurses"
# attributes = { source = "./ncurses.tg.ts" }
# [tool.tangram.imports.pcre2]
# specifier = "pcre2"
# attributes = { source = "./pcre2.tg.ts" }
# [tool.tangram.imports.std]
# specifier = "std"
# attributes = { source = "./std" }
# ///

import ncurses
import pcre2
import std

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
    checksum = "sha256:d1008fb78dcae1323ddab664bcb352a61f022b1b131bd8018548e021d975ec7a"
    archive = await std.download.extractArchive(
        {
            "base": "https://www.greenwoodsoftware.com/less",
            "checksum": checksum,
            "extension": ".tar.gz",
            "name": metadata["name"],
            "version": metadata["version"],
        }
    )
    return tg.Directory.expect(await std.directory.unwrap(tg.Directory.expect(archive)))


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
    return tg.Directory.expect(await std.autotools.build(arg, *args))


default = build


async def test() -> tg.Value.Type:
    spec = await std.assert_.defaultSpec(metadata)
    return await std.assert_.pkg(await tg.command(build), spec)
