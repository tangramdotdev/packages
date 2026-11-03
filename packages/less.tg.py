# /// script
# [tool.tangram.dependencies.ncurses]
# specifier = "ncurses"
# attributes = { source = "./ncurses.tg.ts" }
# [tool.tangram.dependencies.pcre2]
# specifier = "pcre2"
# attributes = { source = "./pcre2.tg.ts" }
# [tool.tangram.dependencies.std_assert]
# specifier = "std"
# attributes = { source = "./std", get = "assert.tg.ts" }
# [tool.tangram.dependencies.std_autotools]
# specifier = "std"
# attributes = { source = "./std", get = "autotools.tg.ts" }
# [tool.tangram.dependencies.std_directory]
# specifier = "std"
# attributes = { source = "./std", get = "directory.tg.ts" }
# [tool.tangram.dependencies.std_download]
# specifier = "std"
# attributes = { source = "./std", get = "download.tg.ts" }
# ///

import ncurses
import pcre2
import std_assert
import std_autotools
import std_directory
import std_download

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
    archive = await std_download.download.build(
        {
            "base": "https://www.greenwoodsoftware.com/less",
            "checksum": checksum,
            "extension": ".tar.gz",
            "mode": "extract",
            "name": metadata["name"],
            "version": metadata["version"],
        }
    )
    return await std_directory.unwrap.build(tg.Directory.expect(archive))


deps = {
    "ncurses": {"build": ncurses.build, "kind": "runtime"},
    "pcre2": {"build": pcre2.build, "kind": "runtime"},
}


async def build(*args: tg.Value.Type) -> tg.Directory:
    arg = {
        "source": await source(),
        "deps": deps,
        "phases": {
            "configure": {"args": ["--with-regex=pcre2"]},
        },
    }
    return await std_autotools.build.build(arg, *args)


default = build


async def test() -> bool:
    spec = await std_assert.defaultSpec.build(metadata)
    return await std_assert.pkg.build(await tg.command(build), spec)
