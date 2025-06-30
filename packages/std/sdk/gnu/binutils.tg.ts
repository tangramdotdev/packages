import * as bootstrap from "../../bootstrap.tg.ts";
import * as std from "../../tangram.ts";

export const metadata = {
	homepage: "https://www.gnu.org/software/binutils/",
	license: "GPL-3.0-or-later",
	name: "binutils",
	repository: "https://sourceware.org/git/gitweb.cgi?p=binutils-gdb.git",
	version: "2.45",
};

export const source = async (build: string) => {
	const { name, version } = metadata;
	const checksum =
		"sha256:7f288c9a869582d53dc645bf1b9e90cc5123f6862738850472ddbca69def47a3";
	return std.download.fromGnu({
		name,
		version,
		compression: "zst",
		checksum,
	});
};

export type Arg = {
	bootstrap?: boolean;
	autotools?: std.autotools.Arg;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
	target?: string;
};

/** Obtain the GNU binutils. */
export const build = async (arg?: tg.Unresolved<Arg>) => {
	const {
		autotools = {},
		bootstrap: bootstrap_ = false,
		build: build_,
		env: env_,
		host: host_,
		sdk,
		source: source_,
		target: target_,
	} = arg ? await tg.resolve(arg) : {};
	const host = host_ ?? (await std.triple.host());
	const build = build_ ?? host;
	const target = target_ ?? host;

	// Collect configuration.
	const configure = {
		args: [
			"--disable-dependency-tracking",
			"--disable-nls",
			"--disable-werror",
			"--enable-deterministic-archives",
			"--enable-gprofng=no",
			"--with-sysroot=$OUTPUT",
			`--build=${build}`,
			`--host=${host}`,
			`--target=${target}`,
		],
	};

	// NOTE: We could pull in `dependencies.texinfo` to avoid needing to set `MAKEINFO=true`, but we do not need the docs here and texinfo transitively adds more rebuilds than the other required dependencies, which would increase the total build time needlessly.
	const makeinfoOverride = {
		args: ["MAKEINFO=true"],
	};

	const phases = {
		configure,
		build: makeinfoOverride,
		install: makeinfoOverride,
	};

	const envs: Array<tg.Unresolved<std.env.Arg>> = [];
	envs.push({
		CFLAGS: tg.Mutation.suffix("-Wno-implicit-function-declaration", " "),
	});
	const env = std.env.arg(...envs, env_);

	const output = await std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			bootstrap: bootstrap_,
			defaultCrossArgs: false,
			defaultCrossEnv: false,
			fortifySource: host === target,
			env,
			opt: "3",
			phases,
			sdk,
			source: source_ ?? source(build),
		},
		autotools,
	);

	return output;
};

export default build;

export const test = async () => {
	const host = await bootstrap.toolchainTriple(await std.triple.host());
	const sdkArg = await bootstrap.sdk.arg(host);

	const binaries = [
		"ar",
		"as",
		"ld",
		"nm",
		"objcopy",
		"objdump",
		"ranlib",
		"strip",
	];

	// FIXME
	// await std.assert.pkg({ buildFn: build, binaries, metadata });
	return true;
};
