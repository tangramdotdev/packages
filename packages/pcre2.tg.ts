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

export const source = () => {
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

export type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const build = async (...args: std.Args<Arg>) => {
	const {
		autotools = {},
		build,
		env,
		host,
		sdk,
		source: source_,
	} = await std.packages.applyArgs<Arg>(...args);

	let configureArgs = [
		"--disable-dependency-tracking",
		"--enable-fast-install=no",
	];
	if (build !== host) {
		configureArgs = configureArgs.concat([
			`--build=${build}`,
			`--host=${host}`,
		]);
	}
	const configure = { args: configureArgs };
	const phases = { configure };

	return std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			env,
			phases,
			sdk,
			source: source_ ?? source(),
		},
		autotools,
	);
};

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
