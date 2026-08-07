import * as bootstrap from "../../bootstrap.tg.ts";
import * as std from "../../tangram.ts";
import gettext from "../../autotools/gettext.tg.ts";
import { rust } from "../../wrap/workspace.tg.ts";
import zlib from "../dependencies/zlib.tg.ts";

const metadata = {
	name: "git",
	version: "2.55.0",
};

export async function source() {
	const { name, version } = metadata;
	const extension = ".tar.xz";
	const base = `https://mirrors.edge.kernel.org/pub/software/scm/git`;
	const checksum =
		"sha256:457fdb04dc8728e007d4688695e6912e6f680727920f2a40bf11eacc17505357";
	return await std.download
		.extractArchive({ base, checksum, name, version, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
}

export type Arg = std.autotools.Arg;

/** Git compiles its `gitcore` crate with cargo, which must be invocable as `cargo` on the `PATH`. The distributed toolchain is not directly executable in a sandbox, so shim it behind the bootstrap interpreter. */
async function rustShims() {
	const host = std.triple.host();
	const toolchain = await tg.build(rust, {}).named("rust toolchain");

	let interpreter = tg``;
	if (std.triple.os(host) === "linux") {
		const { ldso, libDir } = await std.sdk.toolchainComponents({
			env: await std.env.compose(bootstrap.sdk.env(host)),
			host: bootstrap.toolchainTriple(host),
		});
		tg.assert(ldso);
		interpreter = tg`${ldso} --library-path ${libDir} `;
	}

	return tg`
		mkdir -p "$PWD/rust_shims"
		echo "#!/bin/sh" > "$PWD/rust_shims/cargo"
		echo 'set -eu' >> "$PWD/rust_shims/cargo"
		echo 'exec ${interpreter}${toolchain}/bin/cargo "$@"' >> "$PWD/rust_shims/cargo"
		echo "#!/bin/sh" > "$PWD/rust_shims/rustc"
		echo 'set -eu' >> "$PWD/rust_shims/rustc"
		echo 'exec ${interpreter}${toolchain}/bin/rustc "$@"' >> "$PWD/rust_shims/rustc"
		chmod +x "$PWD/rust_shims/cargo" "$PWD/rust_shims/rustc"
		export PATH="$PWD/rust_shims:$PATH"
	`;
}

export async function build(...args: tg.Args<Arg>) {
	const prepare = {
		post: tg`
			export CARGO_HOME="$PWD/cargo_home"
			mkdir -p "$CARGO_HOME"
			${await rustShims()}
		`,
	};

	const buildPhase = `make -j "$(nproc)"`;

	const configure = {
		args: ["--with-openssl=NO", "--without-tcltk"],
	};

	const install = `make install`;

	const phases = {
		prepare,
		build: buildPhase,
		configure,
		install,
	};

	const result = std.autotools.build(
		{
			buildInTree: true,
			env: std.env.arg(zlib(), gettext()),
			phases,
			source: source(),
		},
		...args,
	);
	return result;
}

export default build;
