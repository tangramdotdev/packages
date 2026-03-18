import * as ncurses from "ncurses" with { local: "./ncurses.tg.ts" };
import * as std from "std" with { local: "./std" };

export const metadata = {
	homepage: "https://www.swift.org/",
	license: "Apache-2.0",
	name: "swift",
	repository: "https://github.com/swiftlang/swift",
	version: "6.1.2",
	tag: "swift/6.1.2",
	provides: {
		binaries: ["swift", "swiftc"],
	},
};

// See https://www.swift.org/download/.
const RELEASES: { [key: string]: { checksum: tg.Checksum; url: string } } = {
	["aarch64-linux"]: {
		checksum:
			"sha256:0be937ec11860cad109ab422541643f7c6b1156daa91c9e2c70d8f03ce245cb6",
		url: `https://download.swift.org/swift-${metadata.version}-release/ubuntu2404-aarch64/swift-${metadata.version}-RELEASE/swift-${metadata.version}-RELEASE-ubuntu24.04-aarch64.tar.gz`,
	},
	["x86_64-linux"]: {
		checksum: "sha256:none",
		url: `https://download.swift.org/swift-${metadata.version}-release/ubuntu2404/swift-${metadata.version}-RELEASE/swift-${metadata.version}-RELEASE-ubuntu24.04.tar.gz`,
	},
};

export type Arg = {
	host?: string;
};

export const build = async (...args: std.Args<Arg>): Promise<tg.Directory> => {
	const { host: host_ } = await std.args.apply<Arg, Arg>({
		args: args as std.Args<Arg>,
		map: async (arg) => arg,
		reduce: {},
	});
	const host = host_ ?? std.triple.host();
	const system = std.triple.archAndOs(host);
	tg.assert(
		system in RELEASES,
		`${system} is not supported for prebuilt Swift toolchains.`,
	);

	const release = RELEASES[system as keyof typeof RELEASES];
	tg.assert(release !== undefined);
	const { checksum, url } = release;

	const downloaded = await std.download.extractArchive({ checksum, url });
	tg.assert(downloaded instanceof tg.Directory);
	const swift = await std.directory.unwrap(downloaded);

	const ncursesArtifact = await ncurses.build({ host });
	// Swift's prebuilt binaries link against libncurses.so.6, but our ncurses
	// only provides the unversioned libncurses.so symlink. Add a compat symlink.
	const ncursesLibDir = await ncursesArtifact
		.get("lib")
		.then(tg.Directory.expect);
	const ncursesLib = await tg.directory(ncursesLibDir, {
		["libncurses.so.6"]: tg.symlink("libncurses.so"),
	});

	// Wrap the main binaries.
	let artifact = tg.directory(swift);
	for (const bin of ["usr/bin/swift", "usr/bin/swiftc"]) {
		const file = await swift.get(bin);
		tg.assert(file instanceof tg.File);
		artifact = tg.directory(artifact, {
			[bin]: std.wrap(file, {
				libraryPaths: [
					tg`${swift}/usr/lib`,
					tg`${swift}/usr/lib/swift/linux`,
					ncursesLib,
				],
			}),
		});
	}

	// Flatten usr/ to top-level so bin/swift works.
	const usr = await artifact
		.then((d) => d.get("usr"))
		.then(tg.Directory.expect);
	return usr;
};

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
