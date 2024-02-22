import * as bootstrap from "../bootstrap.tg.ts";
import * as std from "../tangram.tg.ts";

export let metadata = {
	homepage: "https://musl.libc.org",
	license: "MIT",
	name: "musl",
	repository: "https://git.musl-libc.org/cgit/musl",
	version: "1.2.4",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let unpackFormat = ".tar.gz" as const;
	let packageArchive = std.download.packageArchive({
		name,
		version,
		unpackFormat,
	});
	let checksum =
		"sha256:7a35eae33d5372a7c0da1188de798726f68825513b7ae3ebe97aaaa52114f039";
	let url = `https://musl.libc.org/releases/${packageArchive}`;
	let source = tg.Directory.expect(
		await std.download({ url, checksum, unpackFormat }),
	);
	source = await std.directory.unwrap(source);

	let patch = tg.File.expect(await tg.include("musl_permission.patch"));
	source = await bootstrap.patch(source, patch);

	return source;
});

export let build = tg.target(async (arg?: std.sdk.BuildEnvArg) => {
	let host = await tg.Triple.host(arg);
	let hostSystem = tg.Triple.archAndOs(host);

	let configure = { args: [`--enable-debug`, `--enable-optimize=*`] };

	let install = {
		args: [`DESTDIR="$OUTPUT"`],
	};

	let phases = {
		configure,
		install,
	};

	let env = [
		bootstrap.sdk.env(arg),
		bootstrap.make.build(arg),
		{
			CPATH: tg.Mutation.unset(),
			MAKEFLAGS: "--output-sync --silent",
		},
	];

	let result = await std.autotools.build({
		env,
		host,
		phases,
		prefixPath: "/",
		sdk: { bootstrapMode: true },
		source: source(),
	});

	// The ld-musl symlink installed by default points to a broken absolute path. Use a relativesymlink instead.
	result = await tg.directory(result, {
		[`lib/${interpreterName(hostSystem)}`]: tg.symlink("libc.so"),
	});

	return result;
});

export default build;

export let interpreterPath = (triple: tg.Triple.Arg) =>
	`lib/${interpreterName(triple)}`;

export let interpreterName = (triple: tg.Triple.Arg) => {
	let arch = tg.Triple.arch(tg.Triple.archAndOs(tg.triple(triple)));
	return `ld-musl-${arch}.so.1`;
};

export let linkerPath = (tripleArg: tg.Triple.Arg) => {
	let triple = tg.triple(tripleArg);
	triple.environment = "musl";
	let tripleString = tg.Triple.toString(triple);
	return `${tripleString}/bin/ld`;
};
