import * as libpsl from "libpsl" with { local: "../libpsl" };
import * as openssl from "openssl" with { local: "../openssl" };
import * as zlib from "zlib" with { local: "../zlib" };
import * as zstd from "zstd" with { local: "../zstd" };
import * as std from "std" with { local: "../std" };
import { $ } from "std" with { local: "../std" };

export const metadata = {
	homepage: "https://curl.se/",
	license: "MIT",
	name: "curl",
	repository: "https://github.com/curl/curl",
	version: "8.16.0",
	tag: "curl/8.16.0",
	provides: {
		binaries: ["curl"],
		libraries: ["curl"],
	},
};

export const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:a21e20476e39eca5a4fc5cfb00acf84bbc1f5d8443ec3853ad14c26b3c85b970";
	const owner = name;
	const repo = name;
	const tag = `curl-${version.replace(/\./g, "_")}`;
	return std.download.fromGithub({
		owner,
		repo,
		tag,
		checksum,
		source: "release",
		version,
	});
};

export type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	dependencies?: {
		libpsl?: std.args.DependencyArg<libpsl.Arg>;
		openssl?: std.args.DependencyArg<openssl.Arg>;
		zlib?: std.args.DependencyArg<zlib.Arg>;
		zstd?: std.args.DependencyArg<zstd.Arg>;
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

	const configure = {
		args: [
			"--disable-dependency-tracking",
			"--disable-silent-rules",
			"--enable-optimize",
			"--with-openssl",
			tg`--with-ca-bundle=${std.caCertificates()}/ca-bundle.crt`,
		],
	};
	const phases = { configure };

	const deps = [
		std.env.runtimeDependency(libpsl.build, dependencyArgs.libpsl),
		std.env.runtimeDependency(openssl.build, dependencyArgs.openssl),
		std.env.runtimeDependency(zlib.build, dependencyArgs.zlib),
		std.env.runtimeDependency(zstd.build, dependencyArgs.zstd),
	];

	const env = [
		...deps.map((dep: any) =>
			std.env.envArgFromDependency(build, env_, host, sdk, dep),
		),
		env_,
	];

	return std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			env: std.env.arg(...env),
			phases,
			sdk,
			setRuntimeLibraryPath: true,
			source: source_ ?? source(),
		},
		autotools,
	);
};

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	await std.assert.pkg(build, spec);

	const result = await $`
		set -x
		echo "Checking that we can download a file."
		mkdir -p $OUTPUT
		curl -o $OUTPUT/example http://example.com
		echo "Checking that we can download via HTTPS."
		curl -o $OUTPUT/tangram https://www.tangram.dev
	`
		.env(build())
		.checksum("sha256:any")
		.network(true)
		.then(tg.Directory.expect);

	const exampleContents = await result
		.get("example")
		.then(tg.File.expect)
		.then((f) => f.text());
	tg.assert(exampleContents.length > 0);
	tg.assert(exampleContents.startsWith("<!doctype html>"));

	const tangramContents = await result
		.get("tangram")
		.then(tg.File.expect)
		.then((f) => f.text());
	tg.assert(tangramContents.length > 0);
	tg.assert(tangramContents.startsWith("<!DOCTYPE html>"));
	return true;
};
