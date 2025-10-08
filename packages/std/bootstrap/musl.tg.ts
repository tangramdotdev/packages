import * as bootstrap from "../bootstrap.tg.ts";
import * as std from "../tangram.ts";
import { autotoolsInternal } from "../utils.tg.ts";
import muslPermissionPatch from "./musl_permission.patch" with { type: "file" };

export const metadata = {
	homepage: "https://musl.libc.org",
	license: "MIT",
	name: "musl",
	repository: "https://git.musl-libc.org/cgit/musl",
	version: "1.2.5",
	tag: "musl/1.2.5",
};

export const source = async () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:a9a118bbe84d8764da0ea0d28b3ab3fae8477fc7e4085d90102b8596fc7c75e4";
	const url = `https://musl.libc.org/releases/${name}-${version}.tar.gz`;
	return await std.download
		.extractArchive({ url, checksum })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap)
		.then((source) => bootstrap.patch(source, muslPermissionPatch));
};

export type Arg = {
	build?: string | undefined;
	env?: std.env.Arg;
	host?: string | undefined;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const build = async (arg?: Arg) => {
	const host = arg?.host ?? (await std.triple.host());
	const hostSystem = std.triple.archAndOs(host);

	const configure = { args: [`--enable-debug`, `--enable-optimize=*`] };

	const install = {
		args: [`DESTDIR="$OUTPUT"`],
	};

	// The ld-musl symlink installed by default points to a broken absolute path that cannot be checked in. Replace with a relative symlink.
	const fixup = `cd $OUTPUT/lib && rm ${interpreterName(
		hostSystem,
	)} && ln -s libc.so ${interpreterName(hostSystem)}`;

	const phases = {
		configure,
		install,
		fixup,
	};

	const env = std.env.arg(
		bootstrap.sdk(host),
		bootstrap.make.build({ host }),
		{
			CPATH: tg.Mutation.unset() as tg.Mutation<tg.Template>,
			LIBRARY_PATH: tg.Mutation.unset() as tg.Mutation<tg.Template>,
		},
		{ utils: false },
	);

	return await autotoolsInternal({
		bootstrap: true,
		env,
		host,
		phases,
		prefixPath: "/",
		source: source(),
	});
};

export default build;

export const interpreterPath = (triple: string) =>
	`lib/${interpreterName(triple)}`;

export const interpreterName = (triple: string) => {
	const arch = std.triple.arch(triple);
	return `ld-musl-${arch}.so.1`;
};

export const linkerPath = (triple: string) => {
	std.triple.assert(triple);
	return `${triple}/bin/ld`;
};
