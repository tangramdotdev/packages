import * as gmp from "gmp" with { path: "../gmp" };
import * as gnutls from "gnutls" with { path: "../gnutls" };
import * as libpsl from "libpsl" with { path: "../libpsl" };
import * as libiconv from "libiconv" with { path: "../libiconv" };
import * as nettle from "nettle" with { path: "../nettle" };
import * as pcre2 from "pcre2" with { path: "../pcre2" };
import * as std from "std" with { path: "../std" };
import { $ } from "std" with { path: "../std" };
import * as zlib from "zlib" with { path: "../zlib" };
import * as zstd from "zstd" with { path: "../zstd" };

export const metadata = {
	homepage: "https://www.gnu.org/software/wget/",
	license: "GPL-3.0-or-later",
	name: "wget",
	repository: "https://www.gnu.org/software/wget/",
	version: "1.25.0",
	provides: {
		binaries: ["wget"],
	},
};

export const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:766e48423e79359ea31e41db9e5c289675947a7fcf2efdcedb726ac9d0da3784";
	return std.download.fromGnu({ name, version, checksum });
};

export type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	dependencies?: {
		gmp?: std.args.DependencyArg<gmp.Arg>;
		gnutls?: std.args.DependencyArg<gnutls.Arg>;
		libiconv?: std.args.DependencyArg<libiconv.Arg>;
		libpsl?: std.args.DependencyArg<libpsl.Arg>;
		nettle?: std.args.DependencyArg<nettle.Arg>;
		pcre2?: std.args.DependencyArg<pcre2.Arg>;
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
		dependencies: depedencyArgs = {},
		env: env_,
		host,
		sdk,
		source: source_,
	} = await std.packages.applyArgs<Arg>(...args);

	const dependencies = [
		std.env.runtimeDependency(gmp.build, depedencyArgs.gmp),
		std.env.runtimeDependency(gnutls.build, depedencyArgs.gnutls),
		std.env.runtimeDependency(nettle.build, depedencyArgs.nettle),
		std.env.runtimeDependency(libiconv.build, depedencyArgs.libiconv),
		std.env.runtimeDependency(libpsl.build, depedencyArgs.libpsl),
		std.env.runtimeDependency(pcre2.build, depedencyArgs.pcre2),
		std.env.runtimeDependency(zlib.build, depedencyArgs.zlib),
		std.env.runtimeDependency(zstd.build, depedencyArgs.zstd),
	];

	const envs: tg.Unresolved<Array<std.env.Arg>> = [
		...dependencies.map((dep) =>
			std.env.envArgFromDependency(build, env_, host, sdk, dep),
		),
		env_,
	];

	let output = await std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			env: std.env.arg(...envs),
			sdk,
			source: source_ ?? source(),
		},
		autotools,
	);

	// Wrap the binary to include the CA certificates.
	const wgetFile = tg.File.expect(await output.get("bin/wget"));
	const wrappedWget = std.wrap(wgetFile, {
		args: [tg`--ca-certificate=${std.caCertificates()}/cacert.pem`],
	});
	output = await tg.directory(output, {
		["bin/wget"]: wrappedWget,
	});
	return output;
};

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	await std.assert.pkg(build, spec);

	const result = await $`
		echo "Checking that we can download a file."
		mkdir -p $OUTPUT
		wget -O $OUTPUT/example http://example.com
		echo "Checking that we can download via HTTPS."
		wget -O $OUTPUT/tangram https://www.tangram.dev
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
