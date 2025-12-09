import * as std from "std" with { local: "./std" };

export const metadata = {
	homepage: "https://github.com/PCRE2Project/pcre2",
	name: "pcre2",
	repository: "https://github.com/PCRE2Project/pcre2",
	license: "https://github.com/PCRE2Project/pcre2/blob/master/LICENCE",
	version: "10.47",
	tag: "pcre2/10.47",
	provides: {
		libraries: ["pcre2-8"],
	},
};

const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:c08ae2388ef333e8403e670ad70c0a11f1eed021fd88308d7e02f596fcd9dc16";
	const owner = "PCRE2Project";
	const repo = name;
	const tag = `pcre2-${version}`;
	return std.download.fromGithub({
		checksum,
		owner,
		source: "release",
		repo,
		tag,
		version,
	});
};

export type Arg = std.autotools.Arg;

export const build = async (...args: std.Args<Arg>) => {
	const arg = await std.autotools.arg(
		{
			source: source(),
			phases: {
				configure: {
					args: ["--disable-dependency-tracking", "--enable-fast-install=no"],
				},
			},
		},
		...args,
	);
	let phases = arg.phases;
	if (arg.build !== arg.host) {
		phases = await std.phases.mergePhases(phases, {
			configure: {
				args: [`--build=${arg.build}`, `--host=${arg.host}`],
			},
		});
	}
	return std.autotools.build({ ...arg, phases });
};

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
