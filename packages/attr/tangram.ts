import * as std from "std" with { source: "../std" };

export const metadata = {
	homepage: "https://savannah.nongnu.org/projects/attr",
	hostPlatforms: ["aarch64-linux", "x86_64-linux"],
	license: "GPL-2.0-or-later",
	name: "attr",
	repository: "https://git.savannah.nongnu.org/cgit/attr.git",
	version: "2.6.0",
	tag: "attr/2.6.0",
	provides: {
		binaries: ["attr", "getfattr", "setfattr"],
		headers: ["attr/attributes.h", "attr/error_context.h", "attr/libattr.h"],
		libraries: ["attr"],
	},
};

function source() {
	const { name, version } = metadata;
	const checksum =
		"sha256:6c8a2148a7b85043b68492bce43316b0e2e214fc4e628c7ede078e76e216330b";
	const base = `https://download.savannah.gnu.org/releases/${name}`;
	const extension = ".tar.xz";
	return std.download
		.extractArchive({ checksum, name, base, version, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
}

export type Arg = std.autotools.Arg;

export async function build(...args: tg.Args<Arg>) {
	const arg = await std.autotools.arg(
		{
			source: source(),
			phases: {
				configure: {
					args: [
						"--disable-dependency-tracking",
						"--disable-rpath",
						"--with-pic",
					],
				},
			},
		},
		...args,
	);
	std.assert.supportedHost(arg.host, metadata);
	return std.autotools.build(arg);
}

export default build;

export async function test() {
	const spec = {
		...metadata.provides,
		binaries: std.assert.allBinaries(metadata.provides.binaries, {
			testArgs: [],
			snapshot: "Usage:",
			exitOnErr: false,
		}),
		metadata,
	};
	return await std.assert.pkg(build, spec);
}
