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
	let host = await std.Triple.host(arg);
	let hostSystem = std.Triple.system(host);

	let prepare = "set -x && env";
	let configure_ = { args: [`--enable-debug`, `--enable-optimize`] };

	let install = tg`make DESTDIR="$OUTPUT" install`;

	let phases = {
		prepare,
		configure: configure_,
		install,
	};

	let env = [
		bootstrap.sdk.env(arg),
		bootstrap.make.build(arg),
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

export let interpreterPath = (system: std.Triple.Arg) =>
	`lib/${interpreterName(system)}`;

export let interpreterName = (system: std.Triple.Arg) => {
	let arch = tg.System.arch(std.Triple.system(std.triple(system)));
	return `ld-musl-${arch}.so.1`;
};

export let linkerPath = (system: tg.System) => {
	let triple = std.triple(system);
	triple.environment = "musl";
	let tripleString = std.Triple.toString(triple);
	return `${tripleString}/bin/ld`;
};
