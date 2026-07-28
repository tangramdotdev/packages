import * as gmp from "gmp" with { source: "./gmp" };
import * as std from "std" with { source: "./std" };

export const metadata = {
	homepage: "https://www.lysator.liu.se/~nisse/nettle/",
	license: "LGPL-3.0-or-later",
	name: "nettle",
	repository: "https://git.lysator.liu.se/nettle/nettle",
	version: "4.0",
	tag: "nettle/4.0",
	provides: {
		libraries: ["hogweed", "nettle"],
	},
};

export function source() {
	const { name, version } = metadata;
	const checksum =
		"sha256:3addbc00da01846b232fb3bc453538ea5468da43033f21bb345cb1e9073f5094";
	return std.download.fromGnu({ name, version, checksum });
}

export function deps() {
	return std.deps({
		gmp: gmp.build,
	});
}

export type Arg = std.autotools.Arg & std.deps.Arg<typeof deps>;

export function build(...args: tg.Args<Arg>) {
	return std.autotools.build(
		{
			source: source(),
			deps,
			phases: {
				configure: {
					args: [
						"--disable-dependency-tracking",
						"--disable-documentation",
						tg`--libdir=${tg.output}/lib`,
					],
				},
			},
		},
		...args,
	);
}

export default build;

export async function test() {
	const spec: std.assert.PackageSpec = {
		...std.assert.defaultSpec(metadata),
		libraries: std.assert.allLibraries(["hogweed", "nettle"], {
			runtimeDeps: [gmp.build()],
		}),
	};
	return await std.assert.pkg(build, spec);
}
