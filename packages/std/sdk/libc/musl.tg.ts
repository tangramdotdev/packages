import * as bootstrap from "../../bootstrap.tg.ts";
import * as std from "../../tangram.tg.ts";
import muslPermissionPatch from "./musl_permission.patch" with { type: "file" };

export let metadata = {
	name: "musl",
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
	return await std
		.download({ url, checksum })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap)
		.then((source) => bootstrap.patch(source, muslPermissionPatch));
});

export type Arg = {
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
	libcc?: tg.File;
};

export default tg.target(async (arg?: Arg) => {
	let {
		build: build_,
		env: env_,
		host: host_,
		libcc = false,
		sdk,
		source: source_,
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
	env.push(
		std.utils.env({
			sdk: bootstrap.sdk.arg(build),
			host: build,
		}),
	);
	env = env.concat([{ CPATH: tg.Mutation.unset() }]);

	let result = await std.autotools.build({
		...std.triple.rotate({ build, host }),
		env: std.env.arg(env),
		phases,
		prefixPath: "/", // It's going in a sysroot.
		sdk,
		source: source_ ?? source(),
	});

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
