import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	name: "openssl",
	version: "3.2.0",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let checksum =
		"sha256:14c826f07c7e433706fb5c69fa9e25dab95684844b4c962a2cf1bf183eb4690e";
	let unpackFormat = ".tar.gz" as const;
	let url = `https://www.openssl.org/source/${name}-${version}${unpackFormat}`;
	let download = tg.Directory.expect(
		await std.download({
			checksum,
			unpackFormat,
			url,
		}),
	);
	let source = await std.directory.unwrap(download);
	return source;
});

type Arg = {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	build?: tg.Triple.Arg;
	env?: std.env.Arg;
	host?: tg.Triple.Arg;
	sdk?: tg.MaybeNestedArray<std.sdk.Arg>;
	source?: tg.Directory;
};

export let openssl = tg.target(async (arg?: Arg) => {
	let {
		autotools = [],
		build,
		host: host_,
		source: source_,
		...rest
	} = arg ?? {};
	let host = await tg.Triple.host(host_);

	let sourceDir = source_ ?? source();

	let prepare = tg`cp -R ${sourceDir}/* . && chmod -R u+w .`;
	let osCompiler =
		host.os === "darwin"
			? host.arch === "aarch64"
				? `darwin64-arm64`
				: `darwin64-${host.arch}`
			: `${host.os}-${host.arch}`;
	let configure = {
		command: tg`perl ./Configure ${osCompiler}`,
		args: ["--libdir=lib"],
	};
	// NOTE: The full `make install` consists of three steps. The final step installs documentation and take a disproportionately long time. We just build the first two steps to avoid this.
	let install = {
		args: tg.Mutation.set(["install_sw", "install_ssldirs"]),
	};
	let phases = { prepare, configure, install };

	let openssl = await std.autotools.build(
		{
			...rest,
			...tg.Triple.rotate({ build, host }),
			phases,
			source: sourceDir,
		},
		autotools,
	);

	return tg.directory(openssl, {
		["bin/openssl"]: std.wrap(
			tg.File.expect(await openssl.get("bin/openssl")),
			{
				identity: "wrapper",
				libraryPaths: [tg.symlink(tg`${openssl}/lib`)],
			},
		),
		["share/pkgconfig"]: tg.symlink("../../lib/pkgconfig"),
	});
});

export default openssl;

export let test = tg.target(async () => {
	let source = tg.directory({
		["main.c"]: tg.file(`
			#include <stdio.h>
			int main () {}
		`),
	});

	return std.build(
		tg`
		 	echo "Checking if we can run openssl"
			openssl --version
			echo "Checking if we can link against libssl."
			cc ${source}/main.c -o $OUTPUT -lssl -lcrypto
		`,
		{ env: [std.sdk(), openssl()] },
	);
});
