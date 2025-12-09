import * as std from "std" with { local: "../std" };

export const metadata = {
	homepage: "https://www.scylladb.com/",
	hostPlatforms: ["aarch64-linux", "x86_64-linux"],
	license: "AGPL-3.0",
	name: "scylladb",
	repository: "https://github.com/scylladb/scylladb",
	version: "2025.3.4",
	tag: "scylladb/2025.3.4",
	provides: {
		binaries: ["scylla", "iotune", "nodetool"],
	},
};

export type Arg = {
	host?: string;
};

export const build = async (...args: std.Args<Arg>) => {
	const { host: host_ } = await std.packages.applyArgs<Arg>(...args);
	const host = host_ ?? std.triple.host();
	std.assert.supportedHost(host, metadata);
	const arch = std.triple.arch(host);

	const { version } = metadata;
	const buildId = "0.20251116.898f193ef677";
	const checksum = linuxChecksums[arch];
	tg.assert(checksum !== undefined, `no checksum available for ${arch}`);

	const baseUrl = `https://downloads.scylladb.com/downloads/scylla/relocatable/scylladb-2025.3`;
	const fileName = `scylla-${version}-${buildId}.${arch}.tar.gz`;
	const url = `${baseUrl}/${fileName}`;

	// Download and extract the tarball.
	const extracted = await std.download
		.extractArchive({ url, checksum })
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
};

export default build;

const linuxChecksums: { [key: string]: tg.Checksum } = {
	x86_64:
		"sha256:22dc64611017d16d3d99f4fee90d29d4041d1c3fdabe3b9739ec68719a12076a",
	aarch64:
		"sha256:7042d46555411769e6ee6ca935bdfb792df7168119ca3f8d602ab2ce08f18b76",
};

export const test = async () => {
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
};
