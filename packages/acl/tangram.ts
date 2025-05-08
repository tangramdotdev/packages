import * as attr from "attr" with { path: "../attr" };
import * as std from "std" with { path: "../std" };

export const metadata = {
	homepage: "https://savannah.nongnu.org/projects/acl",
	hosts: ["aarch64-linux", "x86_64-linux"],
	license: "GPL-2.0-or-later",
	name: "acl",
	repository: "https://git.savannah.nongnu.org/cgit/acl.git",
	version: "2.3.2",
	provides: {
		binaries: ["chacl", "getfacl", "setfacl"],
		headers: ["acl/libacl.h", "sys/acl.h"],
		libraries: ["acl"],
	},
};

export const source = async () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:97203a72cae99ab89a067fe2210c1cbf052bc492b479eca7d226d9830883b0bd";
	const base = `https://download.savannah.gnu.org/releases/${name}`;
	const extension = ".tar.xz";
	return std.download
		.extractArchive({ base, checksum, extension, name, version })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
};

export type Arg = {
	autotools?: std.autotools.Arg;
	dependencies?: {
		attr?: std.args.DependencyArg<attr.Arg>;
	};
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const build = async (...args: tg.Args<Arg>) => {
	const {
		autotools = {},
		build,
		dependencies: dependencyArgs = {},
		env: env_,
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	std.assert.supportedHost(host, metadata);

	const dependencies = [
		std.env.runtimeDependency(attr.build, dependencyArgs.attr),
	];

	const env = std.env.arg(
		...dependencies.map((dep) =>
			std.env.envArgFromDependency(build, env_, host, sdk, dep),
		),
		env_,
	);

	const configure = {
		args: [
			"--disable-dependency-tracking",
			"--disable-rpath",
			"--disable-silent-rules",
		],
	};
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
	const displaysUsage = (name: string) => {
		return {
			name,
			testArgs: [],
			testPredicate: (stdout: string) => stdout.includes("Usage:"),
		};
	};
	const spec = {
		...std.assert.defaultSpec(metadata),
		binaries: metadata.provides.binaries.map(displaysUsage),
	};
	return await std.assert.pkg(build, spec);
};
