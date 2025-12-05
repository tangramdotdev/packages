import * as std from "std" with { local: "../std" };
import { $ } from "std" with { local: "../std" };

export const metadata = {
	homepage: "https://www.nasm.us/",
	name: "nasm",
	repository: "https://github.com/netwide-assembler/nasm",
	version: "3.01",
	tag: "nasm-3.01",
	provides: {
		binaries: ["nasm", "ndisasm"],
	},
};

export const source = () => {
	std.download;
	const { name, version } = metadata;
	const checksum =
		"sha256:aea120d4adb0241f08ae24d6add09e4a993bc1c4d9f754dbfc8020d6916c9be1";
	const owner = "netwide-assembler";
	const repo = name;
	return std
		.download({
			url: `https://www.nasm.us/pub/${name}/releasebuilds/${version}/nasm-${version}.tar.gz`,
			checksum,
			mode: "extract",
		})
		.then(tg.Directory.expect)
		.then((directory) => directory.get(`${name}-${version}`))
		.then(tg.Directory.expect);
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
	const phases = {
		configure: {
			args: [],
		},
	};
	return std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
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
