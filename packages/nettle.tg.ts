import * as gmp from "gmp" with { local: "./gmp" };
import * as std from "std" with { local: "./std" };

export const metadata = {
	homepage: "https://www.lysator.liu.se/~nisse/nettle/",
	license: "LGPL-3.0-or-later",
	name: "nettle",
	repository: "https://git.lysator.liu.se/nettle/nettle",
	version: "3.10",
	tag: "nettle/3.10",
	provides: {
		libraries: ["hogweed", "nettle"],
	},
};

export const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:b4c518adb174e484cb4acea54118f02380c7133771e7e9beb98a0787194ee47c";
	return std.download.fromGnu({ name, version, checksum });
};

const deps = await std.deps({
	gmp: gmp.build,
});

export type Arg = std.autotools.Arg & std.deps.Arg<typeof deps>;

export const build = (...args: std.Args<Arg>) =>
	std.autotools.build(
		std.autotools.arg(
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
		),
	);

export default build;

export const test = async () => {
	const spec: std.assert.PackageSpec = {
		...std.assert.defaultSpec(metadata),
		libraries: std.assert.allLibraries(["hogweed", "nettle"], {
			runtimeDeps: [gmp.build()],
		}),
	};
	return await std.assert.pkg(build, spec);
};
