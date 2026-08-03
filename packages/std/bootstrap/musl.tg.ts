import * as bootstrap from "../bootstrap.tg.ts";
import * as std from "../tangram.ts";
import { autotoolsInternal } from "../utils.tg.ts";
import muslPermissionPatch from "./musl_permission.patch" with { type: "file" };

export const metadata = {
	homepage: "https://musl.libc.org",
	license: "MIT",
	name: "musl",
	repository: "https://git.musl-libc.org/cgit/musl",
	version: "1.2.6",
	tag: "musl/1.2.6",
};

export async function source() {
	const { name, version } = metadata;
	const checksum =
		"sha256:d585fd3b613c66151fc3249e8ed44f77020cb5e6c1e635a616d3f9f82460512a";
	const url = `https://musl.libc.org/releases/${name}-${version}.tar.gz`;
	return await std.download
		.extractArchive({ url, checksum })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap)
		.then((source) => bootstrap.patch(source, muslPermissionPatch));
}

export type Arg = {
	build?: string | null;
	env?: std.env.Arg | null;
	host?: string | null;
	sdk?: std.sdk.Arg | null;
	source?: tg.Directory | null;
};

export async function build(arg?: Arg) {
	const host = arg?.host ?? std.triple.host();
	const hostSystem = std.triple.archAndOs(host);

	const configure = { args: [`--enable-debug`, `--enable-optimize=*`] };

	const install = {
		args: [tg`DESTDIR="${tg.output}"`],
	};

	// The ld-musl symlink installed by default points to a broken absolute path that cannot be checked in. Replace with a relative symlink.
	const fixup = tg`cd ${tg.output}/lib && rm ${interpreterName(
		hostSystem,
	)} && ln -s libc.so ${interpreterName(hostSystem)}`;

	const phases = {
		configure,
		install,
		fixup,
	};

	const env = std.env.compose(
		bootstrap.sdk(host),
		bootstrap.make.build({ host }),
		{
			CPATH: tg.Mutation.unset() as tg.Mutation<tg.Template>,
			LIBRARY_PATH: tg.Mutation.unset() as tg.Mutation<tg.Template>,
		},
	);

	return await autotoolsInternal({
		sdk: "none",
		env,
		host,
		phases,
		prefixPath: "/",
		processName: metadata.name,
		source: source(),
	});
}

export default build;

export function interpreterPath(triple: string) {
	return `lib/${interpreterName(triple)}`;
}

export function interpreterName(triple: string) {
	const arch = std.triple.arch(triple);
	return `ld-musl-${arch}.so.1`;
}

export function linkerPath(triple: string) {
	std.triple.assert(triple);
	return `${triple}/bin/ld`;
}
