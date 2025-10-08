import * as std from "std" with { local: "../std" };
import * as openssl from "openssl" with { local: "../openssl" };
import * as libiconv from "libiconv" with { local: "../libiconv" };
import * as libxml2 from "libxml2" with { local: "../libxml2" };
import * as xz from "xz" with { local: "../xz" };
import * as zlib from "zlib" with { local: "../zlib" };

export const metadata = {
	homepage: "https://github.com/apple-oss-distributions/xar",
	hostPlatforms: ["aarch64-darwin", "x86_64-darwin"],
	license: "BSD-3-Clause",
	name: "xar",
	repository: "https://github.com/mackyle/xar/tree/master",
	version: "498",
	tag: "xar/498",
	provides: {
		binaries: ["xar"],
	},
};

// NOTE - patches lifted from MacPorts and combined: https://github.com/macports/macports-ports/tree/master/archivers/xar/files
import patches from "./patches" with { type: "directory" };

export const source = async (): Promise<tg.Directory> => {
	const { name, version } = metadata;
	const checksum =
		"sha256:9cee4f80b96cf592ccc545a4fdd51e4da4a5bd3b4734901637d67b043eff3c75";
	const owner = "apple-oss-distributions";
	const repo = name;
	const tag = `${name}-${version}`;
	return await std.download
		.fromGithub({
			checksum,
			owner,
			repo,
			source: "tag",
			tag,
		})
		.then((d) => d.get(name))
		.then(tg.Directory.expect)
		.then((d) => std.patch(d, patches));
};

export type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	dependencies?: {
		openssl?: std.args.DependencyArg<openssl.Arg>;
		libiconv?: std.args.DependencyArg<libiconv.Arg>;
		libxml2?: std.args.DependencyArg<libxml2.Arg>;
		xz?: std.args.DependencyArg<xz.Arg>;
		zlib?: std.args.DependencyArg<zlib.Arg>;
	};
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
		env: env_,
		host,
		sdk,
		source: source_,
	} = await std.packages.applyArgs<Arg>(...args);

	std.assert.supportedHost(host, metadata);

	const processDependency = (dep: any) =>
		std.env.envArgFromDependency(build, env_, host, sdk, dep);

	const deps = [
		std.env.buildDependency(libxml2.build, dependencyArgs.libxml2),
		std.env.runtimeDependency(libiconv.build, dependencyArgs.libiconv),
		std.env.runtimeDependency(libxml2.build, dependencyArgs.libxml2),
		std.env.runtimeDependency(openssl.build, dependencyArgs.openssl),
		std.env.runtimeDependency(xz.build, dependencyArgs.xz),
		std.env.runtimeDependency(zlib.build, dependencyArgs.zlib),
	];

	const envs = [
		...deps.map(processDependency),
		{
			// NOTE - this define is included in libxml/encoding.h but not expanding.
			CFLAGS: tg.Mutation.suffix("-DUTF8Toisolat1=xmlUTF8ToIsolat1", " "),
		},
		env_,
	];
	const env = std.env.arg(...envs);

	const configure = {
		pre: "./autogen.sh",
	};
	const phases = { configure };

	return std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			buildInTree: true,
			developmentTools: true,
			env,
			phases,
			sdk,
			// setRuntimeLibraryPath: true,
			source: source_ ?? source(),
		},
		autotools,
	);
};

export default build;

export const test = async () => {
	const spec = {
		...std.assert.defaultSpec(metadata),
		binaries: [
			{
				name: "xar",
				testPredicate: (stdout: string) => stdout.includes("xar 1.8dev"),
			},
		],
	};
	return await std.assert.pkg(build, spec);
};
