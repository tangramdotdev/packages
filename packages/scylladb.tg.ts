import * as std from "std" with { source: "./std" };

export const metadata = {
	homepage: "https://www.scylladb.com/",
	hostPlatforms: ["aarch64-linux", "x86_64-linux"],
	license: "AGPL-3.0",
	name: "scylladb",
	repository: "https://github.com/scylladb/scylladb",
	version: "2026.2.1",
	tag: "scylladb/2026.2.1",
	provides: {
		binaries: ["scylla", "iotune", "nodetool"],
	},
};

export type Arg = {
	host?: string;
};

export async function build(...args: tg.Args<Arg>) {
	const { host: host_ } = await std.packages.applyArgs<Arg>(...args);
	const host = host_ ?? std.triple.host();
	std.assert.supportedHost(host, metadata);
	const arch = std.triple.arch(host);

	const { version } = metadata;
	const buildId = "0.20260706.41da0874c850";
	const checksum = linuxChecksums[arch];
	tg.assert(checksum !== undefined, `no checksum available for ${arch}`);

	const baseUrl = `https://downloads.scylladb.com/downloads/scylla/relocatable/scylladb-2026.2`;
	const fileName = `scylla-${version}-${buildId}.${arch}.tar.gz`;
	const url = `${baseUrl}/${fileName}`;

	// Download and extract the tarball. It repeats three `scylla/node_exporter` entries, so it must be extracted with tar.
	const extracted = await std.download
		.extractArchive({ url, checksum, tar: true })
		.then(tg.Directory.expect);

	// Wrap the binaries with the bundled libraries.
	const scyllaDir = await extracted.get("scylla").then(tg.Directory.expect);
	const libDir = await scyllaDir.get("libreloc").then(tg.Directory.expect);
	const scyllaBinary = await scyllaDir
		.get("libexec/scylla")
		.then(tg.File.expect);
	const iotuneBinary = await scyllaDir
		.get("libexec/iotune")
		.then(tg.File.expect);

	const scylla = await std.wrap(scyllaBinary, {
		libraryPaths: [libDir],
	});
	const iotune = await std.wrap(iotuneBinary, {
		libraryPaths: [libDir],
	});
	const nodetool = await std.wrap(scyllaBinary, {
		libraryPaths: [libDir],
		args: ["nodetool"],
	});
	const libexec = tg.directory({
		scylla,
		iotune,
	});

	// Return combined directory.
	return tg.directory(scyllaDir, {
		// Replace libexec with wrapped binaries.
		libexec,
		// Provide bin/ with symlinks to libexec/.
		bin: {
			scylla: tg.symlink("../libexec/scylla"),
			iotune: tg.symlink("../libexec/iotune"),
			nodetool,
		},
	});
}

export default build;

const linuxChecksums: { [key: string]: tg.Checksum } = {
	x86_64:
		"sha256:1105159edbdc64a956a286319141723bf564e9e042a9c0f1b15d47168d36250d",
	aarch64:
		"sha256:191a65aef8f181698c406df96767716ddb75bf6fded12301bbfcc11a38f32d26",
};

export async function test() {
	const host = std.triple.host();
	const os = std.triple.os(host);

	if (os !== "linux") {
		console.log("Skipping test: scylladb is only available on Linux");
		return;
	}

	const spec = {
		...std.assert.defaultSpec(metadata),
		binaries: std.assert.binaries(metadata.provides.binaries, {
			scylla: { testArgs: ["--version"] },
			iotune: { testArgs: ["--help"] },
			nodetool: { testArgs: ["help"] },
		}),
	};
	return await std.assert.pkg(build, spec);
}
