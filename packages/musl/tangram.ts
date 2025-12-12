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

const source = async () => {
	const { name, version } = metadata;
	const extension = ".tar.gz";
	const checksum =
		"sha256:a9a118bbe84d8764da0ea0d28b3ab3fae8477fc7e4085d90102b8596fc7c75e4";
	const base = `https://musl.libc.org/releases`;
	return std.download
		.extractArchive({ base, checksum, name, version, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap)
		.then((source) => std.patch(source, muslPermissionPatch));
};

export const interpreterName = (triple: string) => {
	const arch = std.triple.arch(triple);
	return `ld-musl-${arch}.so.1`;
};

export type Arg = std.autotools.Arg & {
	/** Optionally point to a specific implementation of libcc. */
	libcc?: tg.File;
};

export const build = async (...args: std.Args<Arg>) => {
	// Extract libcc from raw args since std.autotools.arg doesn't know about it.
	const libccArg = (await Promise.all(args.map(tg.resolve))).find(
		(a): a is { libcc?: tg.File } =>
			a !== null && typeof a === "object" && "libcc" in a,
	);
	const libcc = libccArg?.libcc;

	const arg = await std.autotools.arg(
		{
			source: source(),
			prefixPath: "/",
			env: { CPATH: tg.Mutation.unset() },
			phases: {
				configure: { args: ["--enable-debug", "--enable-optimize=*"] },
				install: { args: [tg`DESTDIR="${tg.output}"`] },
			},
		},
		...args,
	);

	std.assert.supportedHost(arg.host, metadata);

	const isCrossCompiling = arg.build !== arg.host;
	const configureArgs: Array<string | tg.Template> = [
		`--build=${arg.build}`,
		`--host=${arg.host}`,
	];

	if (isCrossCompiling) {
		configureArgs.push(
			`CROSS_COMPILE="${arg.host}-"`,
			`CC="${arg.host}-gcc"`,
			"--disable-gcc-wrapper",
		);
	}

	if (libcc) {
		configureArgs.push(await tg`LIBCC="${libcc}"`);
	}

	const phases = await std.phases.mergePhases(arg.phases, {
		configure: { args: configureArgs },
	});

	const output = await std.autotools.build({ ...arg, phases });

	// Add an ld.so file, which in musl is just a symlink to libc.so.
	return tg.directory(output, {
		[`lib/${interpreterName(arg.host)}`]: tg.symlink("libc.so"),
	});
};

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
