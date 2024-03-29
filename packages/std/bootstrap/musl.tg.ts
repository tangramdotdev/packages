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
	let host = arg?.host ?? await std.triple.host();
	let hostSystem = std.triple.archAndOs(host);

	let configure = { args: [`--enable-debug`, `--enable-optimize=*`] };

	let install = {
		args: [`DESTDIR="$OUTPUT"`],
	};

	let phases = {
		configure,
		install,
	};

	let env = [
		bootstrap.sdk.env(host),
		bootstrap.make.build(host),
		{
			CPATH: tg.Mutation.unset(),
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

export let interpreterPath = (triple: string) =>
	`lib/${interpreterName(triple)}`;

export let interpreterName = (triple: string) => {
	let arch = std.triple.arch(triple);
	return `ld-musl-${arch}.so.1`;
};

export let linkerPath = (triple: string) => {
	std.triple.assert(triple);
	return `${triple}/bin/ld`;
};
