import * as std from "std" with { local: "../std" };

import muslPermissionPatch from "./musl_permission.patch" with { type: "file" };

export const metadata = {
	homepage: "https://musl.libc.org/",
	hostPlatforms: ["aarch64-linux", "x86_64-linux"],
	license: "MIT",
	name: "musl",
	repository: "https://git.musl-libc.org/cgit/musl",
	version: "1.2.5",
	tag: "musl/1.2.5",
	provides: {
		libraries: ["c"],
	},
};

export const source = async () => {
	const { name, version } = metadata;
	const extension = ".tar.gz";
	const checksum =
		"sha256:a9a118bbe84d8764da0ea0d28b3ab3fae8477fc7e4085d90102b8596fc7c75e4";
	const base = `https://musl.libc.org/releases`;
	return await std.download
		.extractArchive({ base, checksum, name, version, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap)
		.then((source) => std.patch(source, muslPermissionPatch));
};

export type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	/* Optionally point to a specific implementation of libcc. */
	libcc?: tg.File;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const build = async (...args: std.Args<Arg>) => {
	const {
		autotools = {},
		build,
		env: env_,
		host,
		libcc = false,
		sdk,
		source: source_,
	} = await std.packages.applyArgs<Arg>(...args);

	std.assert.supportedHost(host, metadata);

	const isCrossCompiling = build !== host;

	const commonFlags = [
		`--enable-debug`,
		`--enable-optimize=*`,
		`--build=${build}`,
		`--host=${host}`,
	];

	const additionalFlags: Array<string | tg.Template> = isCrossCompiling
		? [`CROSS_COMPILE="${host}-"`, `CC="${host}-gcc"`, "--disable-gcc-wrapper"]
		: [];

	if (libcc) {
		additionalFlags.push(await tg`LIBCC="${libcc}"`);
	}

	const configure = {
		args: [...commonFlags, ...additionalFlags],
	};

	const install = {
		args: [`DESTDIR="$OUTPUT"`],
	};

	const phases = {
		configure,
		install,
	};

	const envs: tg.Unresolved<Array<std.env.Arg>> = [
		{ CPATH: tg.Mutation.unset() },
		env_,
	];

	let result = await std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			env: std.env.arg(...envs, { utils: false }),
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
};

export default build;

export const interpreterName = (triple: string) => {
	const arch = std.triple.arch(triple);
	return `ld-musl-${arch}.so.1`;
};

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
