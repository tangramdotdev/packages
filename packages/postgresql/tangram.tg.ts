import icu from "tg:icu" with { path: "../icu" };
import ncurses from "tg:ncurses" with { path: "../ncurses" };
import openssl from "tg:openssl" with { path: "../openssl" };
import perl from "tg:perl" with { path: "../perl" };
import pkgconfig from "tg:pkgconfig" with { path: "../pkgconfig" };
import readline from "tg:readline" with { path: "../readline" };
import * as std from "tg:std" with { path: "../std" };
import zlib from "tg:zlib" with { path: "../zlib" };
import zstd from "tg:zstd" with { path: "../zstd" };

export let metadata = {
	homepage: "https://www.postgresql.org",
	license: "https://www.postgresql.org/about/licence/",
	name: "postgresql",
	repository: "https://git.postgresql.org/gitweb/?p=postgresql.git;a=summary",
	version: "16.2",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let checksum =
		"sha256:446e88294dbc2c9085ab4b7061a646fa604b4bec03521d5ea671c2e5ad9b2952";
	let extension = ".tar.bz2";
	let packageArchive = std.download.packageArchive({
		name,
		version,
		extension,
	});
	let url = `https://ftp.postgresql.org/pub/source/v${version}/${packageArchive}`;
	let download = tg.Directory.expect(await std.download({ checksum, url }));

	return tg.Directory.expect(await std.directory.unwrap(download));
});

type Arg = {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: tg.MaybeNestedArray<std.sdk.Arg>;
	source?: tg.Directory;
	withIcu?: boolean;
};

export let postgresql = tg.target(async (arg?: Arg) => {
	let {
		autotools = [],
		build,
		env: env_,
		host,
		source: source_,
		withIcu = true,
		...rest
	} = arg ?? {};

	let env = [
		ncurses(arg),
		openssl(arg),
		perl(arg),
		pkgconfig(arg),
		readline(arg),
		zlib(arg),
		zstd(arg),
		{
			LDFLAGS: tg.Mutation.templatePrepend(`-ltinfo`, ` `),
		},
		env_,
	];
	if (withIcu) {
		env.push(icu(arg));
	}

	let sourceDir = source_ ?? source();

	let configure = {
		args: ["--with-zstd"],
	};
	if (!withIcu) {
		configure.args.push("--without-icu");
	}
	let phases = { configure };

	let output = await std.autotools.build(
		{
			...rest,
			...std.triple.rotate({ build, host }),
			buildInTree: true,
			env,
			hardeningCFlags: false,
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
	await std.assert.pkg({
		buildFunction: postgresql,
		binaries: ["psql"],
		metadata,
	});
	return true;
});
