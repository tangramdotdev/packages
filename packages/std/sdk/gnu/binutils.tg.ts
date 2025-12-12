import * as bootstrap from "../../bootstrap.tg.ts";
import * as std from "../../tangram.ts";

export const metadata = {
	homepage: "https://www.gnu.org/software/binutils/",
	license: "GPL-3.0-or-later",
	name: "binutils",
	repository: "https://sourceware.org/git/gitweb.cgi?p=binutils-gdb.git",
	version: "2.45",
	tag: "binutils/2.45",
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

export type Arg = Omit<std.autotools.Arg, "deps"> & {
	bootstrap?: boolean;
	target?: string;
};

/** Obtain the GNU binutils. */
export const build = async (...args: std.Args<Arg>) => {
	// First collect args to extract target before passing to autotools.arg.
	// biome-ignore lint/suspicious/noExplicitAny: Arg contains fields not in autotools.Arg.
	const collected = await std.args.apply<any, any>({
		args,
		map: async (arg) => arg,
		reduce: {
			env: (a, b) => std.env.arg(a, b),
			sdk: (a, b) => std.sdk.arg(a, b),
		},
	});
	const { target: target_, ...rest } = collected;

	const arg = await std.autotools.arg(
		{ source: source(std.triple.host()) },
		rest,
	);
	const {
		bootstrap: bootstrap_ = false,
		build,
		env: env_,
		host,
		sdk,
		source: source_,
	} = arg;
	const target = target_ ?? host;

	// Collect configuration.
	const configure = {
		args: [
			"--disable-dependency-tracking",
			"--disable-nls",
			"--disable-werror",
			"--enable-deterministic-archives",
			"--enable-gprofng=no",
			tg`--with-sysroot=${tg.output}`,
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

	const output = await std.autotools.build({
		...arg,
		bootstrap: bootstrap_,
		defaultCrossArgs: false,
		defaultCrossEnv: false,
		fortifySource: host === target,
		env,
		opt: "3",
		phases,
		source: source_,
	});

	return output;
};

export default build;

export const test = async () => {
	const host = bootstrap.toolchainTriple(std.triple.host());
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
