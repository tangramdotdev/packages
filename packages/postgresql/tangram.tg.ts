import ncurses from "tg:ncurses" with { path: "../ncurses" };
// import openssl from "tg:openssl" with { path: "../openssl" };
import readline from "tg:readline" with { path: "../readline" };
import * as std from "tg:std" with { path: "../std" };
import zlib from "tg:zlib" with { path: "../zlib" };

export let metadata = {
	name: "postgresql",
	version: "16.1",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let checksum =
		"sha256:ce3c4d85d19b0121fe0d3f8ef1fa601f71989e86f8a66f7dc3ad546dd5564fec";
	let unpackFormat = ".tar.bz2" as const;
	let url = `https://ftp.postgresql.org/pub/source/v${version}/${name}-${version}${unpackFormat}`;
	let download = tg.Directory.expect(
		await std.download({
			checksum,
			unpackFormat,
			url,
		}),
	);

	return tg.Directory.expect(await std.directory.unwrap(download));
});

type Arg = {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	build?: std.Triple.Arg;
	env?: std.env.Arg;
	host?: std.Triple.Arg;
	sdk?: tg.MaybeNestedArray<std.sdk.Arg>;
	source?: tg.Directory;
};

export let postgresql = tg.target(async (arg?: Arg) => {
	let {
		autotools = [],
		build,
		env: env_,
		host,
		source: source_,
		...rest
	} = arg ?? {};

	//let env = [ncurses(arg), openssl(arg), readline(arg), zlib(arg), env_];
	let env = [ncurses(arg), readline(arg), zlib(arg), env_];

	let sourceDir = source_ ?? source();

	// NOTE - when building out of tree, the configure script breaks when it can't find /bin/pwd. A patch would be a better solution than copying the source.
	let prepare = tg`cp -R ${sourceDir}/* . && chmod -R u+w .`;
	let configure = {
		command: `./configure`,
		args: ["--without-icu"],
	};
	let phases = { prepare, configure };

	let output = await std.autotools.build(
		{
			...rest,
			...std.Triple.rotate({ build, host }),
			env,
			phases,
			source: sourceDir,
		},
		autotools,
	);

	// Wrap output binaries.
	let libDir = tg.Directory.expect(await output.get("lib"));
	let binDir = tg.Directory.expect(await output.get("bin"));
	for await (let [name, artifact] of binDir) {
		let file = tg.File.expect(artifact);
		let wrappedBin = await std.wrap(file, { libraryPaths: [libDir] });
		output = await tg.directory(output, { [`bin/${name}`]: wrappedBin });
	}

	return output;
});

export default postgresql;

export let test = tg.target(async () => {
	return std.build(
		tg`
		echo "Checking to see if we can run psql." | tee $OUTPUT
		psql --version | tee -a $OUTPUT
	`,
		{ env: postgresql() },
	);
});
