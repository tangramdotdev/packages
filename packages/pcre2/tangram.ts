import * as std from "std" with { path: "../std" };

export const metadata = {
	homepage: "https://github.com/PCRE2Project/pcre2",
	name: "pcre2",
	repository: "https://github.com/PCRE2Project/pcre2",
	license: "https://github.com/PCRE2Project/pcre2/blob/master/LICENCE",
	version: "10.44",
	provides: {
		libraries: ["pcre2-8"],
	},
};

export const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:86b9cb0aa3bcb7994faa88018292bc704cdbb708e785f7c74352ff6ea7d3175b";
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
