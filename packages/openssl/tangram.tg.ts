import perl from "tg:perl" with { path: "../perl" };
import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	name: "openssl",
	version: "3.2.1",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let checksum =
		"sha256:83c7329fe52c850677d75e5d0b0ca245309b97e8ecbcfdc1dfdc4ab9fac35b39";
	let unpackFormat = ".tar.gz" as const;
	let url = `https://www.openssl.org/source/${name}-${version}${unpackFormat}`;
	let download = tg.Directory.expect(
		await std.download({
			checksum,
			unpackFormat,
			url,
		}),
	);
	return std.directory.unwrap(download);
});

type Arg = {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: tg.MaybeNestedArray<std.sdk.Arg>;
	source?: tg.Directory;
};

export let openssl = tg.target(async (arg?: Arg) => {
	let {
		autotools = [],
		build,
		env: env_,
		host: host_,
		source: source_,
		...rest
	} = arg ?? {};
	let host = host_ ?? (await std.triple.host());

	let sourceDir = source_ ?? source();

	let prepare = tg`cp -R ${sourceDir}/* . && chmod -R u+w .`;
	let { arch: hostArch, os: hostOs } = std.triple.components(host);
	let osCompiler =
		hostOs === "darwin"
			? hostArch === "aarch64"
				? `darwin64-arm64`
				: `darwin64-${hostArch}`
			: `${hostOs}-${hostArch}`;
	let configure = {
		command: tg`perl ./Configure ${osCompiler}`,
		args: ["--libdir=lib"],
	};
	// NOTE: The full `make install` consists of three steps. The final step installs documentation and take a disproportionately long time. We just build the first two steps to avoid this.
	let install = {
		args: tg.Mutation.set(["install_sw", "install_ssldirs"]),
	};
	let phases = { prepare, configure, install };

	let env = [perl(arg), env_];

	let openssl = await std.autotools.build(
		{
			...rest,
			...std.triple.rotate({ build, host }),
			env,
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
		["share/pkgconfig"]: tg.symlink("../lib/pkgconfig"),
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
