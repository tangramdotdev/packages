import * as perl from "perl" with { path: "../perl" };
import * as pkgConf from "pkgconf" with { path: "../pkgconf" };
import * as std from "std" with { path: "../std" };

export const metadata = {
	homepage: "https://github.com/besser82/libxcrypt",
	name: "libxcrypt",
	license: "LGPL-2.1",
	repository: "https://github.com/besser82/libxcrypt",
	version: "4.4.37",
};

export const source = tg.target(() => {
	const { name, version } = metadata;
	const owner = "besser82";
	const repo = name;
	const tag = `v${version}`;
	const checksum =
		"sha256:902aa2976f959b5ebe55679b1722b8479f8f13cd4ce2ef432b0a84ae298fffd0";
	return std.download.fromGithub({
		checksum,
		compressionFormat: "xz",
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
	dependencies?: {
		perl?: perl.Arg;
	};
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const build = tg.target(async (...args: std.Args<Arg>) => {
	const {
		autotools = {},
		build,
		dependencies: { perl: perlArg = {} } = {},
		env: env_,
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	const configure = {
		args: ["--disable-dependency-tracking"],
	};
	const phases = { configure };

	const dependencies = [
		perl.build({ build, host: build }, perlArg),
		pkgConf.build({ build, host: build }),
	];
	const env = std.env.arg(...dependencies, env_);

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

export default build;

export const test = tg.target(async () => {
	await std.assert.pkg({ buildFn: build, libraries: ["crypt"] });
	return true;
});
