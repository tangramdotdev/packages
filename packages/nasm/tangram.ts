import * as std from "std" with { local: "../std" };
import { $ } from "std" with { local: "../std" };

export const metadata = {
	homepage: "https://www.nasm.us/",
	name: "nasm",
	repository: "https://github.com/netwide-assembler/nasm",
	version: "3.01",
	tag: "nasm-3.01",
	provides: {
		binaries: ["nasm"],
	},
};

export const source = () => {
	const { name, tag } = metadata;
	const checksum =
		"sha256:af2f241ecc061205d73ba4f781f075d025dabaeab020b676b7db144bf7015d6d";
	const owner = "netwide-assembler";
	const repo = name;
	return std.download.fromGithub({
		owner,
		repo,
		tag,
		checksum,
		source: "tag",
	});
};

export type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	dependencies?: {};
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const build = async (...args: std.Args<Arg>) => {
	const {
		autotools = {},
		build,
		dependencies: dependencyArgs = {},
		env,
		host,
		sdk,
		source: source_,
	} = await std.packages.applyArgs<Arg>(...args);

	const configure = {
		args: [],
	};
	const phases = {
		configure: {
			pre: tg`
				autoconf
				./autogen.sh
			`,
		},
	};

	return std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			buildInTree: true,
			developmentTools: true,
			env: std.env.arg(env),
			phases,
			sdk,
			setRuntimeLibraryPath: true,
			source: source_ ?? source(),
		},
		autotools,
	);
};

export default build;
