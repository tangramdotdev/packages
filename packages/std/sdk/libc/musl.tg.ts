import * as bootstrap from "../../bootstrap.tg.ts";
import * as std from "../../tangram.tg.ts";
import * as dependencies from "../dependencies.tg.ts";

export let metadata = {
	name: "musl",
	version: "1.2.5",
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
		"sha256:a9a118bbe84d8764da0ea0d28b3ab3fae8477fc7e4085d90102b8596fc7c75e4";
	let url = `https://musl.libc.org/releases/${packageArchive}`;
	let source = tg.Directory.expect(
		await std.download({ url, checksum, unpackFormat }),
	);
	source = await std.directory.unwrap(source);

	let patch = tg.File.expect(await tg.include("musl_permission.patch"));
	source = await bootstrap.patch(source, patch);

	return source;
});

type Arg = std.sdk.BuildEnvArg & {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	/* Optionally point to a specific implementation of libcc. */
	libcc?: tg.File;
	source?: tg.Directory;
};

export default tg.target(async (arg?: Arg) => {
	let {
		autotools = [],
		build: build_,
		env: env_,
		host: host_,
		libcc = false,
		source: source_,
		...rest
	} = arg ?? {};
	let host = host_ ?? (await std.triple.host());
	let build = build_ ?? host;

	let isCrossCompiling = build !== host;

	let commonFlags = [
		`--enable-debug`,
		`--enable-optimize=*`,
		`--build=${build}`,
		`--host=${host}`,
	];

	let additionalFlags: Array<string | tg.Template> = isCrossCompiling
		? [`CROSS_COMPILE="${host}-"`, `CC="${host}-gcc"`, "--disable-gcc-wrapper"]
		: [];

	if (libcc) {
		additionalFlags.push(await tg`LIBCC="${arg?.libcc}"`);
	}

	let configure = {
		args: [...commonFlags, ...additionalFlags],
	};

	let install = {
		args: [`DESTDIR="$OUTPUT/${host}"`],
	};

	let phases = {
		configure,
		install,
	};

	let env: tg.Unresolved<Array<std.env.Arg>> = [env_];
	if (rest.bootstrapMode) {
		env.push(
			dependencies.env({
				...rest,
				env: std.sdk({ host: build, bootstrapMode: rest.bootstrapMode }),
				host: build,
			}),
		);
	}
	env = env.concat([{ CPATH: tg.Mutation.unset() }]);

	let result = await std.autotools.build(
		{
			...rest,
			...std.triple.rotate({ build, host }),
			env,
			phases,
			prefixPath: "/", // It's going in a sysroot.
			source: source_ ?? source(),
		},
		autotools,
	);

	// Add an ld.so file, which in musl is just a symlink to libc.so.
	result = await tg.directory(result, {
		[`${interpreterPath(host)}`]: tg.symlink("libc.so"),
	});

	return result;
});

export let interpreterPath = (triple: string) => {
	return `${triple}/lib/${interpreterName(triple)}`;
};

export let interpreterName = (triple: string) => {
	let arch = std.triple.arch(triple);
	return `ld-musl-${arch}.so.1`;
};

export let linkerPath = (system: string) => {
	let triple = std.triple.create(system, { environment: "musl" });
	return `${triple}/bin/ld`;
};
