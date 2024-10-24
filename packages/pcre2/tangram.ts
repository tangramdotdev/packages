import * as std from "std" with { path: "../std" };
import { $ } from "std" with { path: "../std" };

export const metadata = {
	homepage: "https://github.com/PCRE2Project/pcre2",
	name: "pcre2",
	repository: "https://github.com/PCRE2Project/pcre2",
	license: "https://github.com/PCRE2Project/pcre2/blob/master/LICENCE",
	version: "10.43",
};

export const source = tg.target(() => {
	const { name, version } = metadata;
	const checksum =
		"sha256:889d16be5abb8d05400b33c25e151638b8d4bac0e2d9c76e9d6923118ae8a34e";
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
});

export type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const default_ = tg.target(async (...args: std.Args<Arg>) => {
	const {
		autotools = {},
		build,
		env,
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

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
});

export default default_;

export const test = tg.target(async () => {
	await std.assert.pkg({
		packageDir: default_(),
		libraries: ["pcre2"],
		metadata,
	});
	return true;
});
