import * as std from "std" with { path: "../std" };
import * as git from "git" with { path: "../git" };
import * as gperf from "gperf" with { path: "../gperf" };
import * as libcap from "libcap" with { path: "../libcap" };
import * as libseccomp from "libseccomp" with { path: "../libseccomp" };
import * as pkgConf from "pkgconf" with { path: "../pkgconf" };
import * as python from "python" with { path: "../python" };
import * as yajl from "yajl" with { path: "../yajl" };

export const metadata = {
	homepage: "https://github.com/containers/crun",
	license: "GPL-2.0, LGPL-2.1",
	name: "crun",
	repository: "https://github.com/containers/crun",
	version: "1.19.1",
};

export const source = tg.target(async (): Promise<tg.Directory> => {
	const { name, version } = metadata;
	const checksum =
		"sha256:969d66362ecea59f6d93c463739178ac6c2b75eda7a550a45de413e2d92def11";
	const owner = "containers";
	const repo = name;
	return std.download.fromGithub({
		checksum,
		compressionFormat: "zst",
		owner,
		repo,
		source: "release",
		tag: version,
		version,
	});
});

export type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	dependencies?: {
		libcap?: libcap.Arg;
		libseccomp?: libseccomp.Arg;
		yajl?: yajl.Arg;
	};
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const default_ = tg.target(async (...args: std.Args<Arg>) => {
	const {
		autotools = {},
		build,
		dependencies: {
			libcap: libcapArg = {},
			libseccomp: libseccompArg = {},
			yajl: yajlArg = {},
		} = {},
		env: env_,
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	const configure = {
		args: [
			"--disable-dependency-tracking",
			"--enable-shared",
			"--disable-systemd",
		],
	};

	const libs = [
		libcap.default_({ build, host }, libcapArg),
		libseccomp.default_({ build, host }, libseccompArg),
		yajl.default_({ build, host }, yajlArg),
	];

	const deps = [
		...libs,
		git.default_({ build, host: build }),
		gperf.default_({ build, host: build }),
		pkgConf.default_({ build, host: build }),
		python.toolchain({ build, host: build }),
	];

	const env = std.env.arg(...deps, env_);

	let output = await std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			env,
			phases: { configure },
			sdk,
			source: source_ ?? source(),
		},
		autotools,
	);

	const libraryPaths = await Promise.all(
		libs.map(async (lib) => (await lib).get("lib").then(tg.Directory.expect)),
	);
	const crun = await output.get("bin/crun").then(tg.File.expect);
	output = await tg.directory(output, {
		["bin/crun"]: std.wrap(crun, { libraryPaths }),
	});
	return output;
});

export default default_;

export const test = tg.target(async () => {
	await std.assert.pkg({
		buildFn: default_,
		binaries: ["crun"],
		metadata,
	});
	return true;
});
