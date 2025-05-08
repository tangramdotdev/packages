import * as bootstrap from "../../bootstrap.tg.ts";
import * as std from "../../tangram.ts";
import muslPermissionPatch from "./musl_permission.patch" with { type: "file" };

export const metadata = {
	name: "musl",
	version: "1.2.5",
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
		.then((source) => bootstrap.patch(source, muslPermissionPatch));
};

export type Arg = {
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg | boolean;
	source?: tg.Directory;
	libcc?: tg.File;
};

export const build = async (arg?: tg.Unresolved<Arg>) => {
	const resolved = await tg.resolve(arg);
	const {
		build: build_,
		env: env_,
		host: host_,
		libcc = false,
		sdk,
		source: source_,
	} = resolved ?? {};
	const host = host_ ?? (await std.triple.host());
	const build = build_ ?? host;

	const isCrossCompiling =
		std.triple.arch(build) !== std.triple.arch(host) ||
		std.triple.os(build) !== std.triple.os(host) ||
		std.triple.environment(build) !== std.triple.environment(host);

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
		additionalFlags.push(await tg`LIBCC="${resolved?.libcc}"`);
	}

	const configure = {
		args: [...commonFlags, ...additionalFlags],
	};

	const install = {
		args: [`DESTDIR="$OUTPUT/${host}"`],
	};

	// The ld-musl symlink installed by default points to a broken absolute path that cannot be checked in. Replace with a relative symlink.
	const fixup = `cd $OUTPUT/${host}/lib && rm ${interpreterName(
		host,
	)} && ln -s libc.so ${interpreterName(host)}`;

	const phases = {
		configure,
		install,
		fixup,
	};

	const env: tg.Unresolved<Array<std.env.Arg>> = [env_];
	env.push({
		CPATH: tg.Mutation.unset() as tg.Mutation<tg.Template>,
		LIBRARY_PATH: tg.Mutation.unset() as tg.Mutation<tg.Template>,
		TANGRAM_LINKER_PASSTHROUGH: true,
	});

	return std.autotools.build({
		...(await std.triple.rotate({ build, host })),
		defaultCrossArgs: false,
		defaultCrossEnv: false,
		env: std.env.arg(...env),
		phases,
		prefixPath: "/", // It's going in a sysroot.
		sdk,
		source: source_ ?? source(),
	});
};

export default build;

export const interpreterPath = (triple: string) => {
	return `${triple}/lib/${interpreterName(triple)}`;
};

export const interpreterName = (triple: string) => {
	const arch = std.triple.arch(triple);
	return `ld-musl-${arch}.so.1`;
};

export const linkerPath = (system: string) => {
	const triple = std.triple.create(system, { environment: "musl" });
	return `${triple}/bin/ld`;
};
