import * as bootstrap from "../bootstrap.tg.ts";
import * as std from "../tangram.tg.ts";
import muslPermissionPatch from "./musl_permission.patch" with { type: "file" };

export let metadata = {
	homepage: "https://musl.libc.org",
	license: "MIT",
	name: "musl",
	repository: "https://git.musl-libc.org/cgit/musl",
	version: "1.2.5",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let checksum =
		"sha256:a9a118bbe84d8764da0ea0d28b3ab3fae8477fc7e4085d90102b8596fc7c75e4";
	let url = `https://musl.libc.org/releases/${name}-${version}.tar.gz`;
	return await std
		.download({ url, checksum })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap)
		.then((source) => bootstrap.patch(source, muslPermissionPatch));
});

export type Arg = {
	build?: string | undefined;
	env?: std.env.Arg;
	host?: string | undefined;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export let build = tg.target(async (arg?: Arg) => {
	let host = arg?.host ?? (await std.triple.host());
	let hostSystem = std.triple.archAndOs(host);

	let configure = { args: [`--enable-debug`, `--enable-optimize=*`] };

	let install = {
		args: [`DESTDIR="$OUTPUT"`],
	};

	let phases = {
		configure,
		install,
	};

	let env = std.env.arg(bootstrap.sdk(host), bootstrap.make.build(host), {
		CPATH: tg.Mutation.unset(),
		LIBRARY_PATH: tg.Mutation.unset(),
	});

	let result = await std.autotools.build({
		env,
		host,
		phases,
		prefixPath: "/",
		sdk: false,
		source: source(),
	});

	// The ld-musl symlink installed by default points to a broken absolute path. Use a relative symlink instead.
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
