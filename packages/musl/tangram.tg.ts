import * as std from "tg:std" with { path: "../std" };

import muslPermissionPatch from "./musl_permission.patch" with { type: "file" };

export let metadata = {
	homepage: "https://musl.libc.org/",
	license: "MIT",
	name: "musl",
	repository: "https://git.musl-libc.org/cgit/musl",
	version: "1.2.5",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let extension = ".tar.gz";
	let packageArchive = std.download.packageArchive({
		extension,
		name,
		version,
	});
	let checksum =
		"sha256:a9a118bbe84d8764da0ea0d28b3ab3fae8477fc7e4085d90102b8596fc7c75e4";
	let url = `https://musl.libc.org/releases/${packageArchive}`;
	let source = tg.Directory.expect(await std.download({ url, checksum }));
	source = await std.directory.unwrap(source);

	source = await std.patch(source, muslPermissionPatch);

	return source;
});

type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	/* Optionally point to a specific implementation of libcc. */
	libcc?: tg.File;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export let build = tg.target(async (...args: std.Args<Arg>) => {
	let {
		autotools = {},
		build: build_,
		env: env_,
		host: host_,
		libcc = false,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);
	let host = host_ ?? (await std.triple.host());
	let build = build_ ?? host;
	if (std.triple.os(host) !== "linux") {
		throw new Error("musl is only supported on Linux");
	}

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
		additionalFlags.push(await tg`LIBCC="${libcc}"`);
	}

	let configure = {
		args: [...commonFlags, ...additionalFlags],
	};

	let install = {
		args: [`DESTDIR="$OUTPUT"`],
	};

	let phases = {
		configure,
		install,
	};

	let env = [{ CPATH: tg.Mutation.unset() }, env_];

	let result = await std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			env: std.env.arg(env),
			phases,
			prefixPath: "/",
			sdk,
			source: source_ ?? source(),
		},
		autotools,
	);

	// Add an ld.so file, which in musl is just a symlink to libc.so.
	result = await tg.directory(result, {
		[`lib/${interpreterName(host)}`]: tg.symlink("libc.so"),
	});

	return result;
});

export default build;

export let interpreterName = (triple: string) => {
	let arch = std.triple.arch(triple);
	return `ld-musl-${arch}.so.1`;
};
