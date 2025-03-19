import * as perl from "perl" with { path: "../perl" };
import * as pkgConf from "pkgconf" with { path: "../pkgconf" };
import * as std from "std" with { path: "../std" };

export const metadata = {
	homepage: "https://github.com/besser82/libxcrypt",
	name: "libxcrypt",
	license: "LGPL-2.1",
	repository: "https://github.com/besser82/libxcrypt",
	version: "4.4.38",
	provides: {
		headers: ["crypt.h"],
		libraries: ["crypt"],
	},
};

export const source = tg.command(() => {
	const { name, version } = metadata;
	const owner = "besser82";
	const repo = name;
	const tag = `v${version}`;
	const checksum =
		"sha256:80304b9c306ea799327f01d9a7549bdb28317789182631f1b54f4511b4206dd6";
	return std.download.fromGithub({
		checksum,
		compression: "xz",
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
		perl?: std.args.DependencyArg<perl.Arg>;
		pkgConf?: std.args.DependencyArg<pkgConf.Arg>;
	};
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const build = tg.command(async (...args: std.Args<Arg>) => {
	const {
		autotools = {},
		build,
		dependencies: dependencyArgs = {},
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
		std.env.buildDependency(perl.build, dependencyArgs.perl),
		std.env.buildDependency(pkgConf.build, dependencyArgs.pkgConf),
	];
	const env = std.env.arg(
		...dependencies.map((dep) =>
			std.env.envArgFromDependency(build, env_, host, sdk, dep),
		),
		env_,
	);

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

export const test = tg.command(async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
});
